import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatProviderDetection, CodexThread } from "../shared/types";

type PathInfoReader = {
  readPathExists: (path: string) => boolean;
  readIsDirectory: (path: string) => boolean;
};

const nodePathInfoReader: PathInfoReader = {
  readPathExists: (path) => {
    try {
      statSync(path);

      return true;
    } catch {
      return false;
    }
  },
  readIsDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};

// OpenCode stores app-wide data here, and its SQLite database has the real project paths.
export const readOpenCodeDataPath = ({ homePath }: { homePath: string }) => {
  return join(homePath, ".local", "share", "opencode");
};

export const readOpenCodeProjectDataPath = ({
  homePath,
}: {
  homePath: string;
}) => {
  return join(readOpenCodeDataPath({ homePath }), "project");
};

export const readOpenCodeDatabasePath = ({
  homePath,
}: {
  homePath: string;
}) => {
  return join(readOpenCodeDataPath({ homePath }), "opencode.db");
};

const pushUniquePath = ({
  paths,
  isPathIncluded,
  path,
}: {
  paths: string[];
  isPathIncluded: { [path: string]: boolean };
  path: string;
}) => {
  if (path.length === 0 || isPathIncluded[path] === true) {
    return;
  }

  paths.push(path);
  isPathIncluded[path] = true;
};

const pushPathsFromSqliteRows = ({
  paths,
  isPathIncluded,
  rows,
  fieldName,
}: {
  paths: string[];
  isPathIncluded: { [path: string]: boolean };
  rows: { [fieldName: string]: unknown }[];
  fieldName: string;
}) => {
  for (const row of rows) {
    const path = row[fieldName];

    if (typeof path !== "string") {
      continue;
    }

    pushUniquePath({ paths, isPathIncluded, path });
  }
};

const readErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown OpenCode error.";
};

const readOpenCodeUnixTime = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.floor(value / 1000);
};

const readStringFromSqliteRow = ({
  row,
  fieldName,
}: {
  row: { [fieldName: string]: unknown };
  fieldName: string;
}) => {
  const value = row[fieldName];

  if (typeof value !== "string") {
    return null;
  }

  return value;
};

const readOpenCodeThreadFromSqliteRow = (row: {
  [fieldName: string]: unknown;
}) => {
  const sessionId = readStringFromSqliteRow({ row, fieldName: "id" });
  const directory = readStringFromSqliteRow({ row, fieldName: "directory" });

  if (sessionId === null || directory === null) {
    return null;
  }

  const title =
    readStringFromSqliteRow({ row, fieldName: "title" }) ?? sessionId;
  const thread: CodexThread = {
    id: `openCode:${sessionId}`,
    name: title,
    preview: title,
    cwd: directory,
    path: null,
    source: "openCode",
    modelProvider: "openCode",
    createdAt: readOpenCodeUnixTime(row.time_created),
    updatedAt: readOpenCodeUnixTime(row.time_updated),
    archived: row.time_archived !== null && row.time_archived !== undefined,
    status: { type: "idle" },
    gitInfo: null,
  };

  return thread;
};

export const readOpenCodeDashboardDataFromDatabase = async ({
  databasePath,
}: {
  databasePath: string;
}) => {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const repoFolders: string[] = [];
  const isRepoFolderIncluded: { [repoFolder: string]: boolean } = {};
  const threads: CodexThread[] = [];

  try {
    pushPathsFromSqliteRows({
      paths: repoFolders,
      isPathIncluded: isRepoFolderIncluded,
      rows: database
        .prepare("SELECT worktree FROM project WHERE worktree != ''")
        .all(),
      fieldName: "worktree",
    });
    pushPathsFromSqliteRows({
      paths: repoFolders,
      isPathIncluded: isRepoFolderIncluded,
      rows: database
        .prepare("SELECT directory FROM session WHERE directory != ''")
        .all(),
      fieldName: "directory",
    });

    for (const row of database
      .prepare(
        "SELECT id, directory, title, time_created, time_updated, time_archived FROM session WHERE directory != '' ORDER BY time_updated DESC",
      )
      .all()) {
      const thread = readOpenCodeThreadFromSqliteRow(row);

      if (thread !== null) {
        threads.push(thread);
      }
    }
  } finally {
    database.close();
  }

  return { repoFolders, threads };
};

export const readOpenCodeDashboardDataForHome = async ({
  homePath,
  pathInfoReader,
}: {
  homePath: string;
  pathInfoReader: PathInfoReader;
}) => {
  const databasePath = readOpenCodeDatabasePath({ homePath });

  if (!pathInfoReader.readPathExists(databasePath)) {
    return { repoFolders: [], threads: [], warnings: [] };
  }

  try {
    return {
      ...(await readOpenCodeDashboardDataFromDatabase({ databasePath })),
      warnings: [],
    };
  } catch (error) {
    return {
      repoFolders: [],
      threads: [],
      warnings: [
        `${databasePath}: Failed to read OpenCode dashboard data. ${readErrorMessage(error)}`,
      ],
    };
  }
};

export const readOpenCodeRepoFoldersForHome = async ({
  homePath,
  pathInfoReader,
}: {
  homePath: string;
  pathInfoReader: PathInfoReader;
}) => {
  const openCodeDashboardData = await readOpenCodeDashboardDataForHome({
    homePath,
    pathInfoReader,
  });

  return {
    repoFolders: openCodeDashboardData.repoFolders,
    warnings: openCodeDashboardData.warnings,
  };
};

export const readChatProviderDetectionsForHome = ({
  homePath,
  pathInfoReader,
}: {
  homePath: string;
  pathInfoReader: PathInfoReader;
}) => {
  const chatProviderDetections: ChatProviderDetection[] = [
    {
      providerId: "openCode",
      isDetected:
        pathInfoReader.readPathExists(readOpenCodeDatabasePath({ homePath })) ||
        pathInfoReader.readIsDirectory(
          readOpenCodeProjectDataPath({ homePath }),
        ),
    },
  ];

  return chatProviderDetections;
};

export const readChatProviderDetections = () => {
  return readChatProviderDetectionsForHome({
    homePath: homedir(),
    pathInfoReader: nodePathInfoReader,
  });
};

export const readOpenCodeRepoFolders = async () => {
  return await readOpenCodeRepoFoldersForHome({
    homePath: homedir(),
    pathInfoReader: nodePathInfoReader,
  });
};

export const readOpenCodeDashboardData = async () => {
  return await readOpenCodeDashboardDataForHome({
    homePath: homedir(),
    pathInfoReader: nodePathInfoReader,
  });
};
