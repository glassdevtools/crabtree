import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CodexThreadStatusChange,
  GitBranchSyncChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitCreatePullRequestRequest,
  GitCreateRefRequest,
  GitDeleteBranchRequest,
  GitDeleteTagRequest,
  GitMergeBranchRequest,
  GitMoveBranchRequest,
  GitSwitchBranchRequest,
  OpenPathRequest,
  PathLauncher,
} from "../shared/types";
import type { AppServerClient } from "./appServerClient";
import { readOrCreateAnalyticsInstallId } from "./analyticsStore";
import { createAppUpdateController } from "./appUpdates";
import { createAppServerClient } from "./appServerClient";
import { convertThreadStatus } from "./codexThreads";
import {
  readDashboardData,
  readDashboardDataAfterGitMutation,
} from "./dashboard";
import { createDashboardRefreshCoordinator } from "./dashboardRefresh";
import {
  checkoutGitCommit,
  commitAllGitChanges,
  createGitBranch,
  createGitPullRequest,
  createGitRef,
  deleteGitBranch,
  deleteGitTag,
  mergeGitBranch,
  moveGitBranch,
  previewGitMerge,
  pushGitBranchSyncChanges,
  readGitMainWorktreePathForPath,
  revertGitBranchSyncChanges,
  stageGitChanges,
  switchGitBranch,
  unstageGitChanges,
} from "./gitActions";

// The main process owns local system access. The renderer only receives narrow, typed IPC methods through preload.
// TODO: AI-PICKED-VALUE: This initial window size gives the graph and thread sidebar enough room on a laptop display.
const MAIN_WINDOW_WIDTH = 1320;
const MAIN_WINDOW_HEIGHT = 860;
const MAIN_WINDOW_MIN_WIDTH = 980;
const MAIN_WINDOW_MIN_HEIGHT = 640;
// The Codex app-server process stays warm so refreshes and status notifications do not pay the startup cost each time.
let appServerClient: AppServerClient | null = null;
let appServerClientPromise: Promise<AppServerClient> | null = null;
let appServerClientVersion = 0;
const { autoUpdater } = electronUpdater;
const appUpdateController = createAppUpdateController({ app, autoUpdater });

const readExternalUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("url must be a non-empty string.");
  }

  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("url must use http or https.");
  }

  return url.toString();
};

const openExternalUrlInBrowser = async (value: unknown) => {
  await shell.openExternal(readExternalUrl(value));
};

const openExternalUrlInBrowserFromWindow = (value: unknown) => {
  void openExternalUrlInBrowser(value).catch((error) => {
    console.error("Failed to open external URL.", error);
  });
};

const readIsInternalAppUrl = (url: string) => {
  if (process.env.ELECTRON_RENDERER_URL) {
    return (
      new URL(url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    );
  }

  return url.startsWith("file:");
};

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: "MoltTree",
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrlInBrowserFromWindow(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (readIsInternalAppUrl(url)) {
      return;
    }

    event.preventDefault();
    openExternalUrlInBrowserFromWindow(url);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
};

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

const readAppServerClient = async () => {
  if (appServerClient !== null) {
    return appServerClient;
  }

  if (appServerClientPromise === null) {
    appServerClientVersion += 1;
    const appServerClientVersionForProcess = appServerClientVersion;

    appServerClientPromise = createAppServerClient({
      onNotification: (notification) => {
        switch (notification.method) {
          case "thread/status/changed": {
            const value = notification.params;

            if (
              !isObject(value) ||
              typeof value.threadId !== "string" ||
              value.threadId.length === 0
            ) {
              return;
            }

            const codexThreadStatusChange: CodexThreadStatusChange = {
              threadId: value.threadId,
              status: convertThreadStatus(value.status),
            };

            for (const browserWindow of BrowserWindow.getAllWindows()) {
              browserWindow.webContents.send(
                "codex:threadStatusChanged",
                codexThreadStatusChange,
              );
            }

            return;
          }
        }
      },
      onClose: () => {
        if (appServerClientVersion !== appServerClientVersionForProcess) {
          return;
        }

        appServerClient = null;
        appServerClientPromise = null;
      },
    });
  }

  const currentAppServerClientPromise = appServerClientPromise;

  try {
    const nextAppServerClient = await currentAppServerClientPromise;

    if (appServerClientPromise === currentAppServerClientPromise) {
      appServerClient = nextAppServerClient;
    }

    return nextAppServerClient;
  } catch (error) {
    if (appServerClientPromise === currentAppServerClientPromise) {
      appServerClientPromise = null;
    }

    throw error;
  }
};

const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
  readFullDashboardData: async () => {
    return await readDashboardData({
      appServerClient: await readAppServerClient(),
    });
  },
  readDashboardDataAfterGitMutation,
});

const runGitMutationForRepoRoot = async <Result>({
  repoRoot,
  mutateGit,
}: {
  repoRoot: string;
  mutateGit: () => Promise<Result>;
}) => {
  try {
    return await mutateGit();
  } finally {
    dashboardRefreshCoordinator.markChangedRepoRoot(repoRoot);
  }
};

const runGitMutationForRepoRoots = async <Result>({
  repoRoots,
  mutateGit,
}: {
  repoRoots: string[];
  mutateGit: () => Promise<Result>;
}) => {
  try {
    return await mutateGit();
  } finally {
    for (const repoRoot of repoRoots) {
      dashboardRefreshCoordinator.markChangedRepoRoot(repoRoot);
    }
  }
};

const readGitCommitChangesRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitCommitChangesRequest must be an object.");
  }

  if (
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    typeof value.message !== "string" ||
    value.message.trim().length === 0
  ) {
    throw new Error("gitCommitChangesRequest needs a path and message.");
  }

  const gitCommitChangesRequest: GitCommitChangesRequest = {
    path: value.path,
    message: value.message.trim(),
  };

  return gitCommitChangesRequest;
};

const readGitCreateBranchRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitCreateBranchRequest must be an object.");
  }

  if (
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    typeof value.branch !== "string" ||
    value.branch.trim().length === 0 ||
    typeof value.expectedHeadSha !== "string" ||
    value.expectedHeadSha.length === 0
  ) {
    throw new Error(
      "gitCreateBranchRequest needs a path, branch, and expected head sha.",
    );
  }

  const gitCreateBranchRequest: GitCreateBranchRequest = {
    path: value.path,
    branch: value.branch.trim(),
    expectedHeadSha: value.expectedHeadSha,
  };

  return gitCreateBranchRequest;
};

const readGitCreateRefRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitCreateRefRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    (value.gitRefType !== "branch" && value.gitRefType !== "tag") ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    typeof value.sha !== "string" ||
    value.sha.length === 0
  ) {
    throw new Error(
      "gitCreateRefRequest needs a repo root, ref type, name, and sha.",
    );
  }

  const gitCreateRefRequest: GitCreateRefRequest = {
    repoRoot: value.repoRoot,
    gitRefType: value.gitRefType,
    name: value.name.trim(),
    sha: value.sha,
  };

  return gitCreateRefRequest;
};

const readGitDeleteBranchRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitDeleteBranchRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.branch !== "string" ||
    value.branch.length === 0 ||
    typeof value.oldSha !== "string" ||
    value.oldSha.length === 0
  ) {
    throw new Error(
      "gitDeleteBranchRequest needs a repo root, branch, and old sha.",
    );
  }

  const gitDeleteBranchRequest: GitDeleteBranchRequest = {
    repoRoot: value.repoRoot,
    branch: value.branch,
    oldSha: value.oldSha,
  };

  return gitDeleteBranchRequest;
};

const readGitDeleteTagRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitDeleteTagRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.tag !== "string" ||
    value.tag.length === 0 ||
    typeof value.oldSha !== "string" ||
    value.oldSha.length === 0
  ) {
    throw new Error("gitDeleteTagRequest needs a repo root, tag, and old sha.");
  }

  const gitDeleteTagRequest: GitDeleteTagRequest = {
    repoRoot: value.repoRoot,
    tag: value.tag,
    oldSha: value.oldSha,
  };

  return gitDeleteTagRequest;
};

const readGitMoveBranchRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitMoveBranchRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.branch !== "string" ||
    value.branch.length === 0 ||
    typeof value.oldSha !== "string" ||
    value.oldSha.length === 0 ||
    typeof value.newSha !== "string" ||
    value.newSha.length === 0 ||
    (value.sourcePath !== null && typeof value.sourcePath !== "string") ||
    (typeof value.sourcePath === "string" && value.sourcePath.length === 0) ||
    (value.targetPath !== null && typeof value.targetPath !== "string") ||
    (typeof value.targetPath === "string" && value.targetPath.length === 0)
  ) {
    throw new Error(
      "gitMoveBranchRequest needs a repo root, branch, old sha, new sha, source path, and target path.",
    );
  }

  const gitMoveBranchRequest: GitMoveBranchRequest = {
    repoRoot: value.repoRoot,
    branch: value.branch,
    oldSha: value.oldSha,
    newSha: value.newSha,
    sourcePath: value.sourcePath,
    targetPath: value.targetPath,
  };

  return gitMoveBranchRequest;
};

const readGitSwitchBranchRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitSwitchBranchRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    typeof value.branch !== "string" ||
    value.branch.trim().length === 0 ||
    typeof value.oldSha !== "string" ||
    value.oldSha.length === 0 ||
    typeof value.newSha !== "string" ||
    value.newSha.length === 0
  ) {
    throw new Error(
      "gitSwitchBranchRequest needs a repo root, path, branch, old sha, and new sha.",
    );
  }

  const gitSwitchBranchRequest: GitSwitchBranchRequest = {
    repoRoot: value.repoRoot,
    path: value.path,
    branch: value.branch.trim(),
    oldSha: value.oldSha,
    newSha: value.newSha,
  };

  return gitSwitchBranchRequest;
};

const readGitCheckoutCommitRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitCheckoutCommitRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.sha !== "string" ||
    value.sha.length === 0
  ) {
    throw new Error("gitCheckoutCommitRequest needs a repo root and sha.");
  }

  const gitCheckoutCommitRequest: GitCheckoutCommitRequest = {
    repoRoot: value.repoRoot,
    sha: value.sha,
  };

  return gitCheckoutCommitRequest;
};

const readGitMergeBranchRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitMergeBranchRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.branch !== "string" ||
    value.branch.trim().length === 0
  ) {
    throw new Error("gitMergeBranchRequest needs a repo root and branch.");
  }

  const gitMergeBranchRequest: GitMergeBranchRequest = {
    repoRoot: value.repoRoot,
    branch: value.branch.trim(),
  };

  return gitMergeBranchRequest;
};

const readGitCreatePullRequestRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitCreatePullRequestRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.baseBranch !== "string" ||
    value.baseBranch.trim().length === 0 ||
    typeof value.headBranch !== "string" ||
    value.headBranch.trim().length === 0 ||
    typeof value.headSha !== "string" ||
    value.headSha.length === 0 ||
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    typeof value.description !== "string"
  ) {
    throw new Error(
      "gitCreatePullRequestRequest needs a repo root, base branch, head branch, head sha, title, and description.",
    );
  }

  const gitCreatePullRequestRequest: GitCreatePullRequestRequest = {
    repoRoot: value.repoRoot,
    baseBranch: value.baseBranch.trim(),
    headBranch: value.headBranch.trim(),
    headSha: value.headSha,
    title: value.title.trim(),
    description: value.description.trim(),
  };

  return gitCreatePullRequestRequest;
};

const readPathLauncher = (value: unknown): PathLauncher => {
  if (value === "vscode" || value === "cursor" || value === "finder") {
    return value;
  }

  throw new Error("launcher must be vscode, cursor, or finder.");
};

const readOpenPathRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("openPathRequest must be an object.");
  }

  if (typeof value.path !== "string" || value.path.length === 0) {
    throw new Error("openPathRequest needs a path.");
  }

  const openPathRequest: OpenPathRequest = {
    path: value.path,
    launcher: readPathLauncher(value.launcher),
  };

  return openPathRequest;
};

const readGitBranchSyncChanges = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new Error("gitBranchSyncChanges must be an array.");
  }

  const gitBranchSyncChanges: GitBranchSyncChange[] = [];
  const zeroSha = "0000000000000000000000000000000000000000";

  for (const changeValue of value) {
    if (!isObject(changeValue)) {
      throw new Error("Each branch sync change must be an object.");
    }

    if (
      typeof changeValue.repoRoot !== "string" ||
      changeValue.repoRoot.length === 0 ||
      (changeValue.gitRefType !== "branch" &&
        changeValue.gitRefType !== "tag") ||
      typeof changeValue.name !== "string" ||
      changeValue.name.length === 0 ||
      (changeValue.localSha !== null &&
        (typeof changeValue.localSha !== "string" ||
          changeValue.localSha.length === 0 ||
          changeValue.localSha === zeroSha)) ||
      (changeValue.originSha !== null &&
        (typeof changeValue.originSha !== "string" ||
          changeValue.originSha.length === 0 ||
          changeValue.originSha === zeroSha)) ||
      (changeValue.localSha === null && changeValue.originSha === null)
    ) {
      throw new Error(
        "Ref sync changes need a repo root, ref type, name, local sha, and origin sha.",
      );
    }

    gitBranchSyncChanges.push({
      repoRoot: changeValue.repoRoot,
      gitRefType: changeValue.gitRefType,
      name: changeValue.name,
      localSha: changeValue.localSha,
      originSha: changeValue.originSha,
    });
  }

  return gitBranchSyncChanges;
};

ipcMain.handle("dashboard:read", async () => {
  return await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
    "full",
  );
});

ipcMain.handle("dashboard:readAfterGitMutation", async () => {
  return await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
    "afterGitMutation",
  );
});

ipcMain.handle("analytics:readInstallId", async () => {
  return await readOrCreateAnalyticsInstallId({
    userDataPath: app.getPath("userData"),
  });
});

ipcMain.handle("appUpdate:readStatus", () => {
  return appUpdateController.readStatus();
});

ipcMain.handle("appUpdate:check", async () => {
  return await appUpdateController.checkForAppUpdate();
});

ipcMain.handle("appUpdate:quitAndInstall", () => {
  appUpdateController.quitAndInstall();
});

ipcMain.handle("codex:openThread", async (_event, threadId: unknown) => {
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("threadId must be a non-empty string.");
  }

  await shell.openExternal(`codex://threads/${threadId}`);
});

ipcMain.handle("codex:openNewThread", async () => {
  await shell.openExternal("codex://new");
});

ipcMain.handle("external:openUrl", async (_event, value: unknown) => {
  await openExternalUrlInBrowser(value);
});

ipcMain.handle("path:open", async (_event, value: unknown) => {
  const openPathRequest = readOpenPathRequest(value);

  switch (openPathRequest.launcher) {
    case "vscode":
      await shell.openExternal(
        `vscode://file${pathToFileURL(openPathRequest.path).pathname}`,
      );
      return;
    case "cursor":
      await shell.openExternal(
        `cursor://file${pathToFileURL(openPathRequest.path).pathname}`,
      );
      return;
    case "finder": {
      const errorMessage = await shell.openPath(openPathRequest.path);

      if (errorMessage.length > 0) {
        throw new Error(errorMessage);
      }
    }
  }
});

ipcMain.handle("clipboard:writeText", async (_event, text: unknown) => {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("text must be a non-empty string.");
  }

  clipboard.writeText(text);
});

ipcMain.handle("git:stageChanges", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  const repoRoot = await readGitMainWorktreePathForPath({ path });
  await runGitMutationForRepoRoot({
    repoRoot,
    mutateGit: async () => {
      await stageGitChanges(path);
    },
  });
});

ipcMain.handle("git:unstageChanges", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  const repoRoot = await readGitMainWorktreePathForPath({ path });
  await runGitMutationForRepoRoot({
    repoRoot,
    mutateGit: async () => {
      await unstageGitChanges(path);
    },
  });
});

ipcMain.handle("git:commitAllChanges", async (_event, value: unknown) => {
  const gitCommitChangesRequest = readGitCommitChangesRequest(value);
  const repoRoot = await readGitMainWorktreePathForPath({
    path: gitCommitChangesRequest.path,
  });

  return await runGitMutationForRepoRoot({
    repoRoot,
    mutateGit: async () => {
      return await commitAllGitChanges(gitCommitChangesRequest);
    },
  });
});

ipcMain.handle("git:createBranch", async (_event, value: unknown) => {
  const gitCreateBranchRequest = readGitCreateBranchRequest(value);
  const repoRoot = await readGitMainWorktreePathForPath({
    path: gitCreateBranchRequest.path,
  });

  await runGitMutationForRepoRoot({
    repoRoot,
    mutateGit: async () => {
      await createGitBranch(gitCreateBranchRequest);
    },
  });
});

ipcMain.handle("git:createRef", async (_event, value: unknown) => {
  const gitCreateRefRequest = readGitCreateRefRequest(value);

  await runGitMutationForRepoRoot({
    repoRoot: gitCreateRefRequest.repoRoot,
    mutateGit: async () => {
      await createGitRef(gitCreateRefRequest);
    },
  });
});

ipcMain.handle("git:deleteBranch", async (_event, value: unknown) => {
  const gitDeleteBranchRequest = readGitDeleteBranchRequest(value);

  await runGitMutationForRepoRoot({
    repoRoot: gitDeleteBranchRequest.repoRoot,
    mutateGit: async () => {
      await deleteGitBranch(gitDeleteBranchRequest);
    },
  });
});

ipcMain.handle("git:deleteTag", async (_event, value: unknown) => {
  const gitDeleteTagRequest = readGitDeleteTagRequest(value);

  await runGitMutationForRepoRoot({
    repoRoot: gitDeleteTagRequest.repoRoot,
    mutateGit: async () => {
      await deleteGitTag(gitDeleteTagRequest);
    },
  });
});

ipcMain.handle("git:moveBranch", async (_event, value: unknown) => {
  const gitMoveBranchRequest = readGitMoveBranchRequest(value);

  await runGitMutationForRepoRoot({
    repoRoot: gitMoveBranchRequest.repoRoot,
    mutateGit: async () => {
      await moveGitBranch(gitMoveBranchRequest);
    },
  });
});

ipcMain.handle("git:switchBranch", async (_event, value: unknown) => {
  const gitSwitchBranchRequest = readGitSwitchBranchRequest(value);

  await runGitMutationForRepoRoot({
    repoRoot: gitSwitchBranchRequest.repoRoot,
    mutateGit: async () => {
      await switchGitBranch(gitSwitchBranchRequest);
    },
  });
});

ipcMain.handle("git:checkoutCommit", async (_event, value: unknown) => {
  const gitCheckoutCommitRequest = readGitCheckoutCommitRequest(value);

  await runGitMutationForRepoRoot({
    repoRoot: gitCheckoutCommitRequest.repoRoot,
    mutateGit: async () => {
      await checkoutGitCommit(gitCheckoutCommitRequest);
    },
  });
});

ipcMain.handle("git:pushBranchSyncChanges", async (_event, value: unknown) => {
  const gitBranchSyncChanges = readGitBranchSyncChanges(value);
  const repoRoots = gitBranchSyncChanges.map(
    (gitBranchSyncChange) => gitBranchSyncChange.repoRoot,
  );

  await runGitMutationForRepoRoots({
    repoRoots,
    mutateGit: async () => {
      await pushGitBranchSyncChanges(gitBranchSyncChanges);
    },
  });
});

ipcMain.handle(
  "git:revertBranchSyncChanges",
  async (_event, value: unknown) => {
    const gitBranchSyncChanges = readGitBranchSyncChanges(value);
    const repoRoots = gitBranchSyncChanges.map(
      (gitBranchSyncChange) => gitBranchSyncChange.repoRoot,
    );

    await runGitMutationForRepoRoots({
      repoRoots,
      mutateGit: async () => {
        await revertGitBranchSyncChanges(gitBranchSyncChanges);
      },
    });
  },
);

ipcMain.handle("git:previewMerge", async (_event, value: unknown) => {
  const gitMergeBranchRequest = readGitMergeBranchRequest(value);

  return await previewGitMerge(gitMergeBranchRequest);
});

ipcMain.handle("git:mergeBranch", async (_event, value: unknown) => {
  const gitMergeBranchRequest = readGitMergeBranchRequest(value);

  return await runGitMutationForRepoRoot({
    repoRoot: gitMergeBranchRequest.repoRoot,
    mutateGit: async () => {
      return await mergeGitBranch(gitMergeBranchRequest);
    },
  });
});

ipcMain.handle("git:createPullRequest", async (_event, value: unknown) => {
  const gitCreatePullRequestRequest = readGitCreatePullRequestRequest(value);

  return await createGitPullRequest(gitCreatePullRequestRequest);
});

app.whenReady().then(() => {
  createMainWindow();
  appUpdateController.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  const currentAppServerClient = appServerClient;
  appServerClient = null;
  appServerClientPromise = null;
  appUpdateController.stop();

  if (currentAppServerClient !== null) {
    currentAppServerClient.close();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
