import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  GitBranchTagChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitDeleteBranchRequest,
  GitMergeBranchRequest,
  GitMoveBranchRequest,
} from "../shared/types";
import { readDashboardData } from "./dashboard";
import {
  checkoutGitCommit,
  commitAllGitChanges,
  createGitBranch,
  deleteGitBranch,
  mergeGitBranch,
  moveGitBranch,
  previewGitMerge,
  pushGitBranchTagChanges,
  resetGitBranchTagChanges,
  stageGitChanges,
  unstageGitChanges,
} from "./gitActions";

// The main process owns local system access. The renderer only receives narrow, typed IPC methods through preload.
// TODO: AI-PICKED-VALUE: This initial window size gives the graph and thread sidebar enough room on a laptop display.
const MAIN_WINDOW_WIDTH = 1320;
const MAIN_WINDOW_HEIGHT = 860;
const MAIN_WINDOW_MIN_WIDTH = 980;
const MAIN_WINDOW_MIN_HEIGHT = 640;
let dashboardReadPromise: ReturnType<typeof readDashboardData> | null = null;
let shouldReadDashboardAgain = false;

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
    let dashboardData = await readDashboardData();

    while (shouldReadDashboardAgain) {
      shouldReadDashboardAgain = false;
      dashboardData = await readDashboardData();
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

ipcMain.handle("vscode:openPath", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  await shell.openExternal(`vscode://file${pathToFileURL(path).pathname}`);
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
