import { createReadStream, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import type { CodexGitInfo, CodexThread } from "../shared/types";

// These limits keep the first dashboard load bounded while still showing a useful history.
const MAX_THREAD_COUNT = 1000;
const CODEX_SESSION_FILE_PREFIX = "rollout-";
const CODEX_SESSION_FILE_SUFFIX = ".jsonl";

type CodexSessionFile = {
  path: string;
  updatedAt: number;
};

type CodexSessionMeta = {
  id: string;
  cwd: string;
  source: string;
  modelProvider: string;
  createdAt: number;
  gitInfo: CodexGitInfo | null;
};

// Codex session files are enough for startup repo discovery, so MoltTree does not need Codex app-server or Keychain access to show the dashboard.

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

const readTimestamp = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: number;
}) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  return Math.floor(timestamp / 1000);
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

const readCodexSessionMeta = (value: unknown) => {
  if (!isObject(value) || value.type !== "session_meta") {
    return null;
  }

  const payload = value.payload;

  if (!isObject(payload) || typeof payload.id !== "string") {
    return null;
  }

  const sessionMeta: CodexSessionMeta = {
    id: payload.id,
    cwd: readString({ value: payload.cwd, fallback: "" }),
    source: readString({
      value: payload.source,
      fallback: readString({ value: payload.originator, fallback: "unknown" }),
    }),
    modelProvider: readString({
      value: payload.model_provider,
      fallback: "unknown",
    }),
    createdAt: readTimestamp({
      value: payload.timestamp,
      fallback: readTimestamp({ value: value.timestamp, fallback: 0 }),
    }),
    gitInfo: convertGitInfo(payload.git),
  };

  return sessionMeta;
};

const readTextFromResponseContent = (value: unknown) => {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    if (!isObject(item) || typeof item.text !== "string") {
      continue;
    }

    if (item.type === "input_text" || item.type === "text") {
      return item.text;
    }
  }

  return null;
};

const readUserMessage = (value: unknown) => {
  if (!isObject(value)) {
    return null;
  }

  if (value.type === "event_msg") {
    const payload = value.payload;

    if (
      isObject(payload) &&
      payload.type === "user_message" &&
      typeof payload.message === "string"
    ) {
      return payload.message;
    }
  }

  if (value.type === "response_item") {
    const payload = value.payload;

    if (
      isObject(payload) &&
      payload.type === "message" &&
      payload.role === "user"
    ) {
      return readTextFromResponseContent(payload.content);
    }
  }

  return null;
};

const readPreview = (message: string) => {
  return message.replace(/\s+/g, " ").trim();
};

const readCodexThreadFromSessionFile = async ({
  sessionFile,
}: {
  sessionFile: CodexSessionFile;
}) => {
  const fileStream = createReadStream(sessionFile.path, { encoding: "utf8" });
  const lineReader = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  let sessionMeta: CodexSessionMeta | null = null;
  let preview = "";

  try {
    for await (const line of lineReader) {
      let value: unknown;

      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }

      if (sessionMeta === null) {
        sessionMeta = readCodexSessionMeta(value);
      }

      if (preview.length === 0) {
        const userMessage = readUserMessage(value);

        if (userMessage !== null) {
          preview = readPreview(userMessage);
        }
      }

      if (sessionMeta !== null && preview.length > 0) {
        break;
      }
    }
  } catch {
    return null;
  } finally {
    lineReader.close();
    fileStream.destroy();
  }

  if (sessionMeta === null) {
    return null;
  }

  const thread: CodexThread = {
    id: sessionMeta.id,
    name: null,
    preview,
    cwd: sessionMeta.cwd,
    path: sessionFile.path,
    source: sessionMeta.source,
    modelProvider: sessionMeta.modelProvider,
    createdAt: sessionMeta.createdAt,
    updatedAt: sessionFile.updatedAt,
    archived: false,
    status: { type: "notLoaded" },
    gitInfo: sessionMeta.gitInfo,
  };

  return thread;
};

const pushCodexSessionFiles = async ({
  sessionFiles,
  directoryPath,
}: {
  sessionFiles: CodexSessionFile[];
  directoryPath: string;
}) => {
  let directoryEntries: Dirent[];

  try {
    directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const directoryEntry of directoryEntries) {
    const entryPath = join(directoryPath, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      await pushCodexSessionFiles({ sessionFiles, directoryPath: entryPath });
      continue;
    }

    if (
      !directoryEntry.isFile() ||
      !directoryEntry.name.startsWith(CODEX_SESSION_FILE_PREFIX) ||
      !directoryEntry.name.endsWith(CODEX_SESSION_FILE_SUFFIX)
    ) {
      continue;
    }

    try {
      const sessionFileStat = await stat(entryPath);

      sessionFiles.push({
        path: entryPath,
        updatedAt: Math.floor(sessionFileStat.mtimeMs / 1000),
      });
    } catch {
      continue;
    }
  }
};

export const readCodexThreadsFromSessionRoot = async ({
  sessionsPath,
}: {
  sessionsPath: string;
}) => {
  const sessionFiles: CodexSessionFile[] = [];
  const threads: CodexThread[] = [];

  await pushCodexSessionFiles({ sessionFiles, directoryPath: sessionsPath });

  sessionFiles.sort((sessionFileA, sessionFileB) => {
    return sessionFileB.updatedAt - sessionFileA.updatedAt;
  });

  for (const sessionFile of sessionFiles.slice(0, MAX_THREAD_COUNT)) {
    const thread = await readCodexThreadFromSessionFile({ sessionFile });

    if (thread !== null) {
      threads.push(thread);
    }
  }

  return threads;
};

export const readCodexThreads = async () => {
  return await readCodexThreadsFromSessionRoot({
    sessionsPath: join(homedir(), ".codex", "sessions"),
  });
};
