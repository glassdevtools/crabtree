import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ChatProviderDetection,
  ChatProviderId,
  ChatProviderRepoFolder,
  ChatThread,
} from "../shared/types";
import type { AppServerClient } from "./appServerClient";
import { readIsCodexCommandDetected } from "./appServerClient";
import { readCodexThreads } from "./codexThreads";

export type ChatProviderDashboardData = {
  providerId: ChatProviderId;
  isDetected: boolean;
  repoFolders: ChatProviderRepoFolder[];
  threads: ChatThread[];
  warnings: string[];
};

type ChatProviderReadContext = {
  homePath: string;
  pathInfoReader: PathInfoReader;
  readAppServerClient: () => Promise<AppServerClient>;
  readIsCodexDetected: () => Promise<boolean>;
};

type ChatProviderDefinition = {
  providerId: ChatProviderId;
  label: string;
  threadFolderDescription: string;
  projectFolderDescription: string;
  readDetection: ({
    homePath,
    pathInfoReader,
    readIsCodexDetected,
  }: ChatProviderReadContext) => Promise<ChatProviderDetection>;
  readDashboardData: ({
    homePath,
    pathInfoReader,
    readAppServerClient,
    readIsCodexDetected,
  }: ChatProviderReadContext) => Promise<ChatProviderDashboardData>;
};

type PathInfoReader = {
  readPathExists: (path: string) => boolean;
  readIsDirectory: (path: string) => boolean;
};

export type ChatProviderProjectOpenTarget =
  | { type: "command"; command: string; args: string[] }
  | { type: "url"; url: string };

const CODEX_DARWIN_PROJECT_OPEN_COMMAND =
  "/Applications/Codex.app/Contents/MacOS/Codex";
const CODEX_PROJECT_OPEN_ARG = "--open-project";

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

  return "Unknown chat provider error.";
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
  const thread: ChatThread = {
    id: `openCode:${sessionId}`,
    providerId: "openCode",
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
  const threads: ChatThread[] = [];

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

  const chatProviderRepoFolders: ChatProviderRepoFolder[] = repoFolders.map(
    (path) => ({
      providerId: "openCode",
      path,
    }),
  );

  return {
    repoFolders: chatProviderRepoFolders,
    threads,
  };
};

const readOpenCodeProviderDetectionForHome = ({
  homePath,
  pathInfoReader,
}: {
  homePath: string;
  pathInfoReader: PathInfoReader;
}): ChatProviderDetection => {
  return {
    providerId: "openCode",
    isDetected:
      pathInfoReader.readPathExists(readOpenCodeDatabasePath({ homePath })) ||
      pathInfoReader.readIsDirectory(readOpenCodeProjectDataPath({ homePath })),
  };
};

export const readOpenCodeDashboardDataForHome = async ({
  homePath,
  pathInfoReader,
}: {
  homePath: string;
  pathInfoReader: PathInfoReader;
}): Promise<ChatProviderDashboardData> => {
  const databasePath = readOpenCodeDatabasePath({ homePath });
  const isDatabaseDetected = pathInfoReader.readPathExists(databasePath);
  const openCodeDetection = readOpenCodeProviderDetectionForHome({
    homePath,
    pathInfoReader,
  });

  if (!isDatabaseDetected) {
    return {
      providerId: "openCode",
      isDetected: openCodeDetection.isDetected,
      repoFolders: [],
      threads: [],
      warnings: [],
    };
  }

  try {
    return {
      providerId: "openCode",
      isDetected: true,
      ...(await readOpenCodeDashboardDataFromDatabase({ databasePath })),
      warnings: [],
    };
  } catch (error) {
    return {
      providerId: "openCode",
      isDetected: true,
      repoFolders: [],
      threads: [],
      warnings: [
        `${databasePath}: Failed to read OpenCode dashboard data. ${readErrorMessage(error)}`,
      ],
    };
  }
};

export const readCodexDashboardData = async ({
  readAppServerClient,
  readIsCodexDetected,
}: {
  readAppServerClient: () => Promise<AppServerClient>;
  readIsCodexDetected: () => Promise<boolean>;
}): Promise<ChatProviderDashboardData> => {
  const isDetected = await readIsCodexDetected();

  if (!isDetected) {
    return {
      providerId: "codex",
      isDetected: false,
      repoFolders: [],
      threads: [],
      warnings: [],
    };
  }

  try {
    const appServerClient = await readAppServerClient();

    return {
      providerId: "codex",
      isDetected: true,
      repoFolders: [],
      threads: await readCodexThreads(appServerClient),
      warnings: [],
    };
  } catch (error) {
    return {
      providerId: "codex",
      isDetected: true,
      repoFolders: [],
      threads: [],
      warnings: [`Codex: Failed to read chat data. ${readErrorMessage(error)}`],
    };
  }
};

const codexChatProviderDefinition: ChatProviderDefinition = {
  providerId: "codex",
  label: "Codex",
  threadFolderDescription: "Codex thread folder",
  projectFolderDescription: "Codex project folder",
  readDetection: async ({ readIsCodexDetected }) => {
    return { providerId: "codex", isDetected: await readIsCodexDetected() };
  },
  readDashboardData: async ({ readAppServerClient, readIsCodexDetected }) => {
    return await readCodexDashboardData({
      readAppServerClient,
      readIsCodexDetected,
    });
  },
};

const openCodeChatProviderDefinition: ChatProviderDefinition = {
  providerId: "openCode",
  label: "OpenCode",
  threadFolderDescription: "OpenCode session folder",
  projectFolderDescription: "OpenCode project folder",
  readDetection: async ({ homePath, pathInfoReader }) => {
    return readOpenCodeProviderDetectionForHome({ homePath, pathInfoReader });
  },
  readDashboardData: async ({ homePath, pathInfoReader }) => {
    return await readOpenCodeDashboardDataForHome({
      homePath,
      pathInfoReader,
    });
  },
};

const CHAT_PROVIDER_DEFINITIONS: ChatProviderDefinition[] = [
  codexChatProviderDefinition,
  openCodeChatProviderDefinition,
];

const chatProviderDefinitionOfId: {
  [id in ChatProviderId]: ChatProviderDefinition;
} = {
  codex: codexChatProviderDefinition,
  openCode: openCodeChatProviderDefinition,
};

const readChatProviderDefinition = (providerId: ChatProviderId) => {
  return chatProviderDefinitionOfId[providerId];
};

export const readChatProviderLabel = (providerId: ChatProviderId) => {
  return readChatProviderDefinition(providerId).label;
};

export const readChatProviderProjectOpenTarget = ({
  providerId,
  path,
  platform,
}: {
  providerId: ChatProviderId;
  path: string;
  platform: NodeJS.Platform;
}): ChatProviderProjectOpenTarget => {
  if (path.length === 0) {
    throw new Error("Chat provider path cannot be empty.");
  }

  switch (providerId) {
    case "codex":
      if (platform !== "darwin") {
        throw new Error(
          "Opening projects in Codex is only supported on macOS.",
        );
      }

      return {
        type: "command",
        command: CODEX_DARWIN_PROJECT_OPEN_COMMAND,
        args: [CODEX_PROJECT_OPEN_ARG, path],
      };
    case "openCode": {
      const openCodeUrl = new URL("opencode://open-project");

      openCodeUrl.searchParams.set("directory", path);

      return { type: "url", url: openCodeUrl.toString() };
    }
  }
};

export const readChatProviderThreadFolderDescription = (
  providerId: ChatProviderId,
) => {
  return readChatProviderDefinition(providerId).threadFolderDescription;
};

export const readChatProviderProjectFolderDescription = (
  providerId: ChatProviderId,
) => {
  return readChatProviderDefinition(providerId).projectFolderDescription;
};

const readChatProviderContext = ({
  readAppServerClient,
  readIsCodexDetected,
}: {
  readAppServerClient: () => Promise<AppServerClient>;
  readIsCodexDetected: () => Promise<boolean>;
}): ChatProviderReadContext => {
  return {
    homePath: homedir(),
    pathInfoReader: nodePathInfoReader,
    readAppServerClient,
    readIsCodexDetected,
  };
};

export const readChatProviderDashboardData = async ({
  readAppServerClient,
}: {
  readAppServerClient: () => Promise<AppServerClient>;
}) => {
  const chatProviderContext = readChatProviderContext({
    readAppServerClient,
    readIsCodexDetected: readIsCodexCommandDetected,
  });

  return await Promise.all(
    CHAT_PROVIDER_DEFINITIONS.map((chatProviderDefinition) =>
      chatProviderDefinition.readDashboardData(chatProviderContext),
    ),
  );
};

export const readChatProviderDetectionsForHome = async ({
  homePath,
  pathInfoReader,
  readIsCodexDetected,
}: {
  homePath: string;
  pathInfoReader: PathInfoReader;
  readIsCodexDetected: () => Promise<boolean>;
}) => {
  const chatProviderContext: ChatProviderReadContext = {
    homePath,
    pathInfoReader,
    readAppServerClient: async () => {
      throw new Error("Chat provider detection should not start app-server.");
    },
    readIsCodexDetected,
  };
  const chatProviderDetections = await Promise.all(
    CHAT_PROVIDER_DEFINITIONS.map((chatProviderDefinition) =>
      chatProviderDefinition.readDetection(chatProviderContext),
    ),
  );

  return chatProviderDetections;
};

export const readChatProviderDetections = async () => {
  return await readChatProviderDetectionsForHome({
    homePath: homedir(),
    pathInfoReader: nodePathInfoReader,
    readIsCodexDetected: readIsCodexCommandDetected,
  });
};

export const readOpenCodeDashboardData = async () => {
  const chatProviderContext = readChatProviderContext({
    readAppServerClient: async () => {
      throw new Error("OpenCode reads should not start app-server.");
    },
    readIsCodexDetected: readIsCodexCommandDetected,
  });

  return await readOpenCodeDashboardDataForHome(chatProviderContext);
};
