import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type {
  CodexGitInfo,
  CodexThread,
  CodexThreadStatus,
} from "../shared/types";
import type { AppServerClient } from "./appServerClient";

// These limits keep the first dashboard load bounded while still showing a useful history.
// TODO: AI-PICKED-VALUE: Page size 200 matches a large sidebar batch without making one app-server response too large.
const MAX_THREAD_COUNT = 1000;
const THREAD_PAGE_SIZE = 200;
// TODO: AI-PICKED-VALUE: Reading 64 KiB chunks keeps the common case cheap while still finding task markers near the end of large rollout files.
const ROLLOUT_STATUS_READ_CHUNK_BYTE_COUNT = 64 * 1024;
// TODO: AI-PICKED-VALUE: Two minutes bridges the status gap for another Codex process without keeping stale interrupted chats active for hours.
const ROLLOUT_ACTIVE_STARTED_MAX_AGE_MS = 2 * 60 * 1000;

// Codex app-server owns thread reads so this app does not need raw transcript parsing.
// The returned thread objects already include cwd and gitInfo for graph matching.
// Runtime status is process-local, so we also inspect the latest task marker in the rollout file to see Codex Desktop tasks that are running in another app-server process.

type RolloutTaskEventType = "taskStarted" | "taskComplete";

type RolloutTaskEvent = {
  type: RolloutTaskEventType;
  timestampMs: number | null;
};

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

const readString = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: string;
}) => {
  if (typeof value === "string") {
    return value;
  }

  return fallback;
};

const readNullableString = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  return null;
};

const readNumber = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: number;
}) => {
  if (typeof value === "number") {
    return value;
  }

  return fallback;
};

const readRolloutTaskEvent = (value: unknown): RolloutTaskEvent | null => {
  if (!isObject(value)) {
    return null;
  }

  const payload = value.payload;

  if (!isObject(payload) || typeof payload.type !== "string") {
    return null;
  }

  const timestampMs =
    typeof value.timestamp === "string" ? Date.parse(value.timestamp) : null;
  const safeTimestampMs =
    timestampMs === null || Number.isNaN(timestampMs) ? null : timestampMs;

  switch (payload.type) {
    case "task_started":
      return { type: "taskStarted", timestampMs: safeTimestampMs };
    case "task_complete":
      return { type: "taskComplete", timestampMs: safeTimestampMs };
    default:
      return null;
  }
};

const readLatestRolloutTaskEventWithTimeFromText = (text: string) => {
  const lines = text.split("\n");

  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex].trim();

    if (line.length === 0) {
      continue;
    }

    let value: unknown;

    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }

    const rolloutTaskEvent = readRolloutTaskEvent(value);

    if (rolloutTaskEvent !== null) {
      return rolloutTaskEvent;
    }
  }

  return null;
};

export const readLatestRolloutTaskEventFromText = (text: string) => {
  return readLatestRolloutTaskEventWithTimeFromText(text)?.type ?? null;
};

const readRolloutTaskStatus = ({
  rolloutTaskEvent,
  latestActivityMs,
  nowMs,
}: {
  rolloutTaskEvent: RolloutTaskEvent | null;
  latestActivityMs: number;
  nowMs: number;
}): CodexThreadStatus | null => {
  if (rolloutTaskEvent === null || rolloutTaskEvent.type === "taskComplete") {
    return null;
  }

  if (
    rolloutTaskEvent.timestampMs === null ||
    nowMs - latestActivityMs > ROLLOUT_ACTIVE_STARTED_MAX_AGE_MS
  ) {
    return null;
  }

  return { type: "active", activeFlags: [] };
};

export const readRolloutTaskStatusFromText = ({
  text,
  latestActivityMs,
  nowMs,
}: {
  text: string;
  latestActivityMs: number;
  nowMs: number;
}) => {
  return readRolloutTaskStatus({
    rolloutTaskEvent: readLatestRolloutTaskEventWithTimeFromText(text),
    latestActivityMs,
    nowMs,
  });
};

const convertGitInfo = (value: unknown): CodexGitInfo | null => {
  if (!isObject(value)) {
    return null;
  }

  return {
    sha: readNullableString(value.sha),
    branch: readNullableString(value.branch),
    originUrl: readNullableString(value.originUrl),
  };
};

export const convertThreadStatus = (value: unknown): CodexThreadStatus => {
  if (!isObject(value) || typeof value.type !== "string") {
    return { type: "notLoaded" };
  }

  switch (value.type) {
    case "active": {
      const activeFlags = Array.isArray(value.activeFlags)
        ? value.activeFlags.filter(
            (activeFlag): activeFlag is string =>
              typeof activeFlag === "string",
          )
        : [];

      return { type: "active", activeFlags };
    }
    case "idle":
      return { type: "idle" };
    case "systemError":
      return { type: "systemError" };
    case "notLoaded":
      return { type: "notLoaded" };
    default:
      return { type: "notLoaded" };
  }
};

const convertThread = ({
  value,
  archived,
}: {
  value: unknown;
  archived: boolean;
}) => {
  if (!isObject(value) || typeof value.id !== "string") {
    return null;
  }

  const thread: CodexThread = {
    id: value.id,
    name: readNullableString(value.name),
    preview: readString({ value: value.preview, fallback: "" }),
    cwd: readString({ value: value.cwd, fallback: "" }),
    path: readNullableString(value.path),
    source: readString({ value: value.source, fallback: "unknown" }),
    modelProvider: readString({
      value: value.modelProvider,
      fallback: "unknown",
    }),
    createdAt: readNumber({ value: value.createdAt, fallback: 0 }),
    updatedAt: readNumber({ value: value.updatedAt, fallback: 0 }),
    archived,
    status: convertThreadStatus(value.status),
    gitInfo: convertGitInfo(value.gitInfo),
  };

  return thread;
};

const readLatestRolloutTaskEvent = async ({
  fileHandle,
  byteCount,
}: {
  fileHandle: FileHandle;
  byteCount: number;
}) => {
  let endByteIndex = byteCount;
  let text = "";

  while (endByteIndex > 0) {
    const startByteIndex = Math.max(
      0,
      endByteIndex - ROLLOUT_STATUS_READ_CHUNK_BYTE_COUNT,
    );
    const buffer = Buffer.alloc(endByteIndex - startByteIndex);

    await fileHandle.read({
      buffer,
      offset: 0,
      length: buffer.length,
      position: startByteIndex,
    });

    text = `${buffer.toString("utf8")}${text}`;

    const rolloutTaskEvent = readLatestRolloutTaskEventWithTimeFromText(text);

    if (rolloutTaskEvent !== null) {
      return rolloutTaskEvent;
    }

    endByteIndex = startByteIndex;
  }

  return null;
};

const readThreadStatusWithRolloutTask = async (
  thread: CodexThread,
): Promise<CodexThreadStatus> => {
  if (thread.status.type === "active" || thread.path === null) {
    return thread.status;
  }

  let byteCount = 0;
  let modifiedAtMs = 0;

  try {
    const stats = await stat(thread.path);
    byteCount = stats.size;
    modifiedAtMs = stats.mtimeMs;
  } catch {
    return thread.status;
  }

  let fileHandle: FileHandle;

  try {
    fileHandle = await open(thread.path, "r");
  } catch {
    return thread.status;
  }

  try {
    const rolloutTaskEvent = await readLatestRolloutTaskEvent({
      fileHandle,
      byteCount,
    });
    return (
      readRolloutTaskStatus({
        rolloutTaskEvent,
        latestActivityMs: modifiedAtMs,
        nowMs: Date.now(),
      }) ?? thread.status
    );
  } finally {
    await fileHandle.close();
  }
};

const readActiveThreads = async (appServerClient: AppServerClient) => {
  const threads: CodexThread[] = [];
  let cursor: string | null = null;

  while (threads.length < MAX_THREAD_COUNT) {
    const result = await appServerClient.request({
      method: "thread/list",
      params: {
        limit: THREAD_PAGE_SIZE,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        cursor,
        useStateDbOnly: true,
      },
    });

    if (!isObject(result) || !Array.isArray(result.data)) {
      return threads;
    }

    for (const item of result.data) {
      const thread = convertThread({ value: item, archived: false });

      if (thread !== null) {
        threads.push(thread);
      }
    }

    cursor = readNullableString(result.nextCursor);

    if (cursor === null || result.data.length === 0) {
      return threads;
    }
  }

  return threads;
};

export const readCodexThreads = async (appServerClient: AppServerClient) => {
  const threads = await readActiveThreads(appServerClient);
  const nextThreads: CodexThread[] = [];

  for (const thread of threads) {
    const status = await readThreadStatusWithRolloutTask(thread);

    if (status === thread.status) {
      nextThreads.push(thread);
      continue;
    }

    nextThreads.push({
      ...thread,
      status,
    });
  }

  return nextThreads;
};
