import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CodexThreadStatusChange,
  GitBranchTagChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitDeleteBranchRequest,
  GitDetachWorktreeBranchRequest,
  GitMergeBranchRequest,
  GitMoveBranchRequest,
  GitSwitchBranchRequest,
  OpenPathRequest,
  PathLauncher,
} from "../shared/types";
import type { AppServerClient } from "./appServerClient";
import { createAppServerClient } from "./appServerClient";
import { convertThreadStatus } from "./codexThreads";
import { readDashboardData } from "./dashboard";
import {
  checkoutGitCommit,
  commitAllGitChanges,
  createGitBranch,
  deleteGitBranch,
  detachGitWorktreeBranch,
  mergeGitBranch,
  moveGitBranch,
  previewGitMerge,
  pushGitBranchTagChanges,
  resetGitBranchTagChanges,
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
let dashboardReadPromise: ReturnType<typeof readDashboardData> | null = null;
let shouldReadDashboardAgain = false;

const startAutoUpdates = () => {
  if (!app.isPackaged) {
    return;
  }

  const appUpdateConfigPath = join(process.resourcesPath, "app-update.yml");
  if (!existsSync(appUpdateConfigPath)) {
    return;
  }

  // Packaged release builds get their update feed from Electron Builder's app-update.yml.
  const { autoUpdater } = electronUpdater;
  autoUpdater.on("error", (error) => {
    console.error("Failed to update MoltTree.", error);
  });
  autoUpdater.checkForUpdatesAndNotify();
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

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
};

const readDashboardDataWithoutOverlap = async () => {
  if (dashboardReadPromise !== null) {
    shouldReadDashboardAgain = true;

    return await dashboardReadPromise;
  }

  const currentDashboardReadPromise = (async () => {
    shouldReadDashboardAgain = false;
    let dashboardData = await readDashboardData({
      appServerClient: await readAppServerClient(),
    });

    while (shouldReadDashboardAgain) {
      shouldReadDashboardAgain = false;
      dashboardData = await readDashboardData({
        appServerClient: await readAppServerClient(),
      });
    }

    return dashboardData;
  })();

  dashboardReadPromise = currentDashboardReadPromise;

  try {
    return await currentDashboardReadPromise;
  } finally {
    if (dashboardReadPromise === currentDashboardReadPromise) {
      dashboardReadPromise = null;
    }
  }
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
    value.branch.trim().length === 0
  ) {
    throw new Error("gitCreateBranchRequest needs a path and branch.");
  }

  const gitCreateBranchRequest: GitCreateBranchRequest = {
    path: value.path,
    branch: value.branch.trim(),
  };

  return gitCreateBranchRequest;
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
    value.newSha.length === 0
  ) {
    throw new Error(
      "gitMoveBranchRequest needs a repo root, branch, old sha, and new sha.",
    );
  }

  const gitMoveBranchRequest: GitMoveBranchRequest = {
    repoRoot: value.repoRoot,
    branch: value.branch,
    oldSha: value.oldSha,
    newSha: value.newSha,
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

const readGitDetachWorktreeBranchRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitDetachWorktreeBranchRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    typeof value.branch !== "string" ||
    value.branch.trim().length === 0 ||
    typeof value.sha !== "string" ||
    value.sha.length === 0
  ) {
    throw new Error(
      "gitDetachWorktreeBranchRequest needs a repo root, path, branch, and sha.",
    );
  }

  const gitDetachWorktreeBranchRequest: GitDetachWorktreeBranchRequest = {
    repoRoot: value.repoRoot,
    path: value.path,
    branch: value.branch.trim(),
    sha: value.sha,
  };

  return gitDetachWorktreeBranchRequest;
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

const readGitBranchTagChanges = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new Error("gitBranchTagChanges must be an array.");
  }

  const gitBranchTagChanges: GitBranchTagChange[] = [];

  for (const changeValue of value) {
    if (!isObject(changeValue)) {
      throw new Error("Each branch tag change must be an object.");
    }

    if (
      typeof changeValue.repoRoot !== "string" ||
      changeValue.repoRoot.length === 0 ||
      typeof changeValue.branch !== "string" ||
      changeValue.branch.length === 0 ||
      typeof changeValue.oldSha !== "string" ||
      changeValue.oldSha.length === 0 ||
      (changeValue.newSha !== null &&
        (typeof changeValue.newSha !== "string" ||
          changeValue.newSha.length === 0))
    ) {
      throw new Error(
        "Branch tag changes need a repo root, branch, old sha, and new sha.",
      );
    }

    gitBranchTagChanges.push({
      repoRoot: changeValue.repoRoot,
      branch: changeValue.branch,
      oldSha: changeValue.oldSha,
      newSha: changeValue.newSha,
    });
  }

  return gitBranchTagChanges;
};

ipcMain.handle("dashboard:read", async () => {
  return await readDashboardDataWithoutOverlap();
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

  await stageGitChanges(path);
});

ipcMain.handle("git:unstageChanges", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  await unstageGitChanges(path);
});

ipcMain.handle("git:commitAllChanges", async (_event, value: unknown) => {
  const gitCommitChangesRequest = readGitCommitChangesRequest(value);

  return await commitAllGitChanges(gitCommitChangesRequest);
});

ipcMain.handle("git:createBranch", async (_event, value: unknown) => {
  const gitCreateBranchRequest = readGitCreateBranchRequest(value);

  await createGitBranch(gitCreateBranchRequest);
});

ipcMain.handle("git:deleteBranch", async (_event, value: unknown) => {
  const gitDeleteBranchRequest = readGitDeleteBranchRequest(value);

  await deleteGitBranch(gitDeleteBranchRequest);
});

ipcMain.handle("git:moveBranch", async (_event, value: unknown) => {
  const gitMoveBranchRequest = readGitMoveBranchRequest(value);

  await moveGitBranch(gitMoveBranchRequest);
});

ipcMain.handle("git:switchBranch", async (_event, value: unknown) => {
  const gitSwitchBranchRequest = readGitSwitchBranchRequest(value);

  await switchGitBranch(gitSwitchBranchRequest);
});

ipcMain.handle("git:detachWorktreeBranch", async (_event, value: unknown) => {
  const gitDetachWorktreeBranchRequest =
    readGitDetachWorktreeBranchRequest(value);

  await detachGitWorktreeBranch(gitDetachWorktreeBranchRequest);
});

ipcMain.handle("git:checkoutCommit", async (_event, value: unknown) => {
  const gitCheckoutCommitRequest = readGitCheckoutCommitRequest(value);

  await checkoutGitCommit(gitCheckoutCommitRequest);
});

ipcMain.handle("git:pushBranchTagChanges", async (_event, value: unknown) => {
  const gitBranchTagChanges = readGitBranchTagChanges(value);

  await pushGitBranchTagChanges(gitBranchTagChanges);
});

ipcMain.handle("git:resetBranchTagChanges", async (_event, value: unknown) => {
  const gitBranchTagChanges = readGitBranchTagChanges(value);

  await resetGitBranchTagChanges(gitBranchTagChanges);
});

ipcMain.handle("git:previewMerge", async (_event, value: unknown) => {
  const gitMergeBranchRequest = readGitMergeBranchRequest(value);

  return await previewGitMerge(gitMergeBranchRequest);
});

ipcMain.handle("git:mergeBranch", async (_event, value: unknown) => {
  const gitMergeBranchRequest = readGitMergeBranchRequest(value);

  await mergeGitBranch(gitMergeBranchRequest);
});

app.whenReady().then(() => {
  createMainWindow();
  startAutoUpdates();

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

  if (currentAppServerClient !== null) {
    currentAppServerClient.close();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
