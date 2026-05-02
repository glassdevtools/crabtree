import type {
  CodexGitInfo,
  CodexThread,
  CodexThreadStatusChange,
  CodexThreadStatus,
} from "../shared/types";
import type { AppServerClient } from "./appServerClient";

// These limits keep the first dashboard load bounded while still showing a useful history.
const MAX_THREAD_COUNT = 1000;
// TODO: AI-PICKED-VALUE: Page size 200 matches a large sidebar batch without making one app-server response too large.
const THREAD_PAGE_SIZE = 200;

// Codex app-server is the only thread source because it owns current titles, cwd values, and running statuses.

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

const readUnixTime = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: number;
}) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);

    if (Number.isFinite(timestamp)) {
      return Math.floor(timestamp / 1000);
    }
  }

  return fallback;
};

const convertGitInfo = (value: unknown): CodexGitInfo | null => {
  if (!isObject(value)) {
    return null;
  }

  return {
    sha: readNullableString(value.sha) ?? readNullableString(value.commit_hash),
    branch: readNullableString(value.branch),
    originUrl:
      readNullableString(value.originUrl) ??
      readNullableString(value.repository_url),
  };
};

export const convertCodexThreadStatus = (value: unknown): CodexThreadStatus => {
  if (typeof value === "string") {
    switch (value) {
      case "active":
      case "running":
        return { type: "active", activeFlags: [] };
      case "idle":
        return { type: "idle" };
      case "systemError":
        return { type: "systemError" };
      case "notLoaded":
        return { type: "notLoaded" };
      default:
        return { type: "notLoaded" };
    }
  }

  if (!isObject(value)) {
    return { type: "notLoaded" };
  }

  switch (value.type) {
    case "running":
      return { type: "active", activeFlags: [] };
    case "notLoaded":
      return { type: "notLoaded" };
    case "idle":
      return { type: "idle" };
    case "systemError":
      return { type: "systemError" };
    case "active": {
      const activeFlagsValue = value.activeFlags ?? value.active_flags;
      const activeFlags = Array.isArray(activeFlagsValue)
        ? activeFlagsValue.filter(
            (activeFlag): activeFlag is string =>
              typeof activeFlag === "string",
          )
        : [];

      return { type: "active", activeFlags };
    }
    default:
      return { type: "notLoaded" };
  }
};

const readThreadIdFromStatusChange = (value: { [key: string]: unknown }) => {
  if (typeof value.threadId === "string" && value.threadId.length > 0) {
    return value.threadId;
  }

  if (typeof value.thread_id === "string" && value.thread_id.length > 0) {
    return value.thread_id;
  }

  if (typeof value.id === "string" && value.id.length > 0) {
    return value.id;
  }

  const thread = value.thread;

  if (
    isObject(thread) &&
    typeof thread.id === "string" &&
    thread.id.length > 0
  ) {
    return thread.id;
  }

  return null;
};

const readStatusValueFromStatusChange = (value: { [key: string]: unknown }) => {
  if (value.status !== undefined) {
    return value.status;
  }

  const thread = value.thread;

  if (isObject(thread)) {
    return thread.status;
  }

  return null;
};

export const readCodexThreadStatusChangeFromAppServerNotification = (
  value: unknown,
) => {
  if (!isObject(value)) {
    return null;
  }

  const threadId = readThreadIdFromStatusChange(value);
  const statusValue = readStatusValueFromStatusChange(value);

  if (threadId === null || statusValue === null) {
    return null;
  }

  const codexThreadStatusChange: CodexThreadStatusChange = {
    threadId,
    status: convertCodexThreadStatus(statusValue),
  };

  return codexThreadStatusChange;
};

export const readCodexThreadStatusChangeFromAppServerTurnStartedNotification = (
  value: unknown,
) => {
  if (!isObject(value)) {
    return null;
  }

  const threadId = readThreadIdFromStatusChange(value);

  if (threadId === null) {
    return null;
  }

  const codexThreadStatusChange: CodexThreadStatusChange = {
    threadId,
    status: { type: "active", activeFlags: [] },
  };

  return codexThreadStatusChange;
};

export const readCodexThreadStatusChangeFromAppServerTurnCompletedNotification =
  (value: unknown) => {
    if (!isObject(value)) {
      return null;
    }

    const threadId = readThreadIdFromStatusChange(value);

    if (threadId === null) {
      return null;
    }

    const codexThreadStatusChange: CodexThreadStatusChange = {
      threadId,
      status: { type: "idle" },
    };

    return codexThreadStatusChange;
  };

export const readCodexThreadFromAppServerValue = (value: unknown) => {
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
      fallback: readString({
        value: value.model_provider,
        fallback: "unknown",
      }),
    }),
    createdAt: readUnixTime({ value: value.createdAt, fallback: 0 }),
    updatedAt: readUnixTime({ value: value.updatedAt, fallback: 0 }),
    archived: value.archived === true,
    status: convertCodexThreadStatus(value.status),
    gitInfo: convertGitInfo(value.gitInfo ?? value.git),
  };

  return thread;
};

export const readCodexThreadFromAppServerReadResponse = (value: unknown) => {
  if (!isObject(value)) {
    return null;
  }

  return readCodexThreadFromAppServerValue(value.thread);
};

export const readCodexThreadLoadedListFromAppServerResult = (
  value: unknown,
) => {
  const threadIds: string[] = [];

  if (!isObject(value) || !Array.isArray(value.data)) {
    return { threadIds, nextCursor: null };
  }

  for (const threadId of value.data) {
    if (typeof threadId === "string" && threadId.length > 0) {
      threadIds.push(threadId);
    }
  }

  return {
    threadIds,
    nextCursor:
      typeof value.nextCursor === "string" && value.nextCursor.length > 0
        ? value.nextCursor
        : null,
  };
};

const readCodexThreadsFromAppServerData = (value: unknown) => {
  const threads: CodexThread[] = [];

  if (!Array.isArray(value)) {
    return threads;
  }

  for (const item of value) {
    const thread = readCodexThreadFromAppServerValue(item);

    if (thread !== null) {
      threads.push(thread);
    }
  }

  return threads;
};

const readCodexThreadsFromAppServerResult = (value: unknown) => {
  if (!isObject(value)) {
    return null;
  }

  return readCodexThreadsFromAppServerData(value.data);
};

export const readCodexThreads = async (appServerClient: AppServerClient) => {
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

    const nextThreads = readCodexThreadsFromAppServerResult(result);

    if (nextThreads === null) {
      throw new Error("Codex app-server thread/list returned invalid data.");
    }

    threads.push(...nextThreads);
    cursor = isObject(result) ? readNullableString(result.nextCursor) : null;

    if (cursor === null || nextThreads.length === 0) {
      break;
    }
  }

  console.log("[MoltTree diagnostics] Codex thread source", {
    source: "app-server",
    threadCount: threads.length,
    threadsWithCwdCount: threads.filter((thread) => thread.cwd.length > 0)
      .length,
    activeThreadCount: threads.filter(
      (thread) => thread.status.type === "active",
    ).length,
    threadSamples: threads.slice(0, 5).map((thread) => ({
      id: thread.id,
      name: thread.name,
      preview: thread.preview,
      cwd: thread.cwd,
      source: thread.source,
      status: thread.status.type,
    })),
  });
  return threads;
};
