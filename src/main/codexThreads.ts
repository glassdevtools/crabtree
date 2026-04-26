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

// Codex app-server owns thread reads so this app does not need raw transcript parsing.
// The returned thread objects already include cwd and gitInfo for graph matching.

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

const convertThreadStatus = (value: unknown): CodexThreadStatus => {
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
  return await readActiveThreads(appServerClient);
};
