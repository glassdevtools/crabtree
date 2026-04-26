import { app, BrowserWindow, ipcMain, shell } from "electron";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import type { GitMergeRequest } from "../shared/types";
import { readDashboardData } from "./dashboard";

// The main process owns local system access. The renderer only receives narrow, typed IPC methods through preload.
// TODO: AI-PICKED-VALUE: This initial window size gives the graph and thread sidebar enough room on a laptop display.
const MAIN_WINDOW_WIDTH = 1320;
const MAIN_WINDOW_HEIGHT = 860;
const MAIN_WINDOW_MIN_WIDTH = 980;
const MAIN_WINDOW_MIN_HEIGHT = 640;
// TODO: AI-PICKED-VALUE: Four random bytes make short readable worktree/temp branch ids while keeping collisions unlikely for local use.
const GIT_MERGE_HASH_BYTE_LENGTH = 4;

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: "Molt Tree",
    backgroundColor: "#f6f4ef",
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

const runGitCommandForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  await simpleGit({ baseDir: path }).raw(args);
};

const readGitTextForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  return (await simpleGit({ baseDir: path }).raw(args)).trim();
};

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

const readGitMergeRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitMergeRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.fromSha !== "string" ||
    value.fromSha.length === 0 ||
    typeof value.toSha !== "string" ||
    value.toSha.length === 0 ||
    (value.targetBranch !== null &&
      (typeof value.targetBranch !== "string" ||
        value.targetBranch.length === 0)) ||
    (value.targetWorktreePath !== null &&
      (typeof value.targetWorktreePath !== "string" ||
        value.targetWorktreePath.length === 0))
  ) {
    throw new Error(
      "gitMergeRequest is missing a repo root, commit sha, or target.",
    );
  }

  const hasTargetBranch = value.targetBranch !== null;
  const hasTargetWorktreePath = value.targetWorktreePath !== null;

  if (hasTargetBranch === hasTargetWorktreePath) {
    throw new Error("gitMergeRequest needs exactly one merge target.");
  }

  const gitMergeRequest: GitMergeRequest = {
    repoRoot: value.repoRoot,
    fromSha: value.fromSha,
    toSha: value.toSha,
    targetBranch: value.targetBranch,
    targetWorktreePath: value.targetWorktreePath,
  };

  return gitMergeRequest;
};

const logGitMerge = (message: string, value: unknown) => {
  console.info(`[Molt Tree merge] ${message}`, value);
};

const startGitMerge = async ({
  repoRoot,
  fromSha,
  toSha,
  targetBranch,
  targetWorktreePath,
}: GitMergeRequest) => {
  const hash = randomBytes(GIT_MERGE_HASH_BYTE_LENGTH).toString("hex");
  const tempBranchName = `temp-${hash}`;
  let isTempBranchCreated = false;
  let targetPath = repoRoot;
  logGitMerge("main start", {
    repoRoot,
    fromSha,
    toSha,
    targetBranch,
    targetWorktreePath,
    tempBranchName,
  });

  if (targetBranch !== null) {
    logGitMerge("main checking repo status before switch", {
      repoRoot,
      targetBranch,
    });
    const statusText = await readGitTextForPath({
      path: repoRoot,
      args: ["status", "--porcelain"],
    });

    if (statusText.length > 0) {
      logGitMerge("main stopped: repo is dirty before switch", {
        repoRoot,
        targetBranch,
        statusText,
      });
      throw new Error("Working tree must be clean before switching branches.");
    }

    logGitMerge("main reading branch head", { repoRoot, targetBranch });
    const branchHead = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", targetBranch],
    });

    if (branchHead !== toSha) {
      logGitMerge("main stopped: target branch moved", {
        targetBranch,
        branchHead,
        toSha,
      });
      throw new Error("Target branch moved. Refresh and try again.");
    }

    logGitMerge("main switching branch", { repoRoot, targetBranch });
    await runGitCommandForPath({
      path: repoRoot,
      args: ["switch", targetBranch],
    });
  }

  if (targetWorktreePath !== null) {
    targetPath = targetWorktreePath;
    logGitMerge("main reading worktree head", {
      targetPath,
      targetWorktreePath,
    });
    const worktreeHead = await readGitTextForPath({
      path: targetPath,
      args: ["rev-parse", "HEAD"],
    });

    if (worktreeHead !== toSha) {
      logGitMerge("main stopped: target worktree moved", {
        targetPath,
        worktreeHead,
        toSha,
      });
      throw new Error("Target worktree moved. Refresh and try again.");
    }
  }

  logGitMerge("main checking target status before merge", { targetPath });
  const targetStatusText = await readGitTextForPath({
    path: targetPath,
    args: ["status", "--porcelain"],
  });

  if (targetStatusText.length > 0) {
    logGitMerge("main stopped: target is dirty", {
      targetPath,
      targetStatusText,
    });
    throw new Error("Merge target must be clean before starting a merge.");
  }

  try {
    logGitMerge("main creating temp branch", {
      targetPath,
      tempBranchName,
      fromSha,
    });
    await runGitCommandForPath({
      path: targetPath,
      args: ["branch", tempBranchName, fromSha],
    });
    isTempBranchCreated = true;

    logGitMerge("main merging temp branch", { targetPath, tempBranchName });
    await runGitCommandForPath({
      path: targetPath,
      args: ["merge", "--no-edit", tempBranchName],
    });
    logGitMerge("main merge finished", { targetPath, tempBranchName });
  } finally {
    if (isTempBranchCreated) {
      logGitMerge("main deleting temp branch", { targetPath, tempBranchName });
      await runGitCommandForPath({
        path: targetPath,
        args: ["branch", "-D", tempBranchName],
      });
    }
  }
};

ipcMain.handle("dashboard:read", async () => {
  return await readDashboardData();
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

  await runGitCommandForPath({ path, args: ["add", "--all", "--", "."] });
});

ipcMain.handle("git:unstageChanges", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  await runGitCommandForPath({
    path,
    args: ["restore", "--staged", "--", "."],
  });
});

ipcMain.handle("git:startMerge", async (_event, value: unknown) => {
  logGitMerge("ipc received git:startMerge", value);
  const gitMergeRequest = readGitMergeRequest(value);
  logGitMerge("ipc parsed git:startMerge", gitMergeRequest);

  try {
    await startGitMerge(gitMergeRequest);
    logGitMerge("ipc completed git:startMerge", gitMergeRequest);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown merge error.";
    logGitMerge("ipc failed git:startMerge", {
      message,
      gitMergeRequest,
    });
    throw error;
  }
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
