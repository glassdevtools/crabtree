import { app, BrowserWindow, ipcMain, shell } from "electron";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import type {
  GitBranchTagChange,
  GitCommitChangesRequest,
  GitDeleteBranchRequest,
  GitDeleteWorktreeRequest,
  GitMergeRequest,
  GitMoveBranchRequest,
} from "../shared/types";
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

const readGitDeleteWorktreeRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitDeleteWorktreeRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.path !== "string" ||
    value.path.length === 0
  ) {
    throw new Error("gitDeleteWorktreeRequest needs a repo root and path.");
  }

  if (value.repoRoot === value.path) {
    throw new Error("Cannot delete the main repository worktree.");
  }

  const gitDeleteWorktreeRequest: GitDeleteWorktreeRequest = {
    repoRoot: value.repoRoot,
    path: value.path,
  };

  return gitDeleteWorktreeRequest;
};

const readGitDeleteBranchRequest = (value: unknown) => {
  if (!isObject(value)) {
    throw new Error("gitDeleteBranchRequest must be an object.");
  }

  if (
    typeof value.repoRoot !== "string" ||
    value.repoRoot.length === 0 ||
    typeof value.branch !== "string" ||
    value.branch.length === 0
  ) {
    throw new Error("gitDeleteBranchRequest needs a repo root and branch.");
  }

  const gitDeleteBranchRequest: GitDeleteBranchRequest = {
    repoRoot: value.repoRoot,
    branch: value.branch,
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

const commitAllGitChanges = async ({
  path,
  message,
}: GitCommitChangesRequest) => {
  await runGitCommandForPath({ path, args: ["add", "--all", "--", "."] });
  await runGitCommandForPath({ path, args: ["commit", "-m", message] });
};

const deleteGitWorktree = async ({
  repoRoot,
  path,
}: GitDeleteWorktreeRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["worktree", "remove", path],
  });
};

const deleteGitBranch = async ({
  repoRoot,
  branch,
}: GitDeleteBranchRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["branch", "-D", branch],
  });
};

const readGitWorktreePathForBranch = async ({
  repoRoot,
  branch,
}: {
  repoRoot: string;
  branch: string;
}) => {
  const text = await readGitTextForPath({
    path: repoRoot,
    args: ["worktree", "list", "--porcelain"],
  });
  const branchReferencePrefix = "refs/heads/";
  let path: string | null = null;
  let worktreeBranch: string | null = null;
  let branchWorktreePath: string | null = null;

  const pushWorktree = () => {
    if (path === null || worktreeBranch !== branch) {
      return;
    }

    branchWorktreePath = path;
  };

  for (const line of text.split("\n")) {
    if (line.length === 0) {
      pushWorktree();
      path = null;
      worktreeBranch = null;
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");

    if (key === "worktree") {
      path = value;
      continue;
    }

    if (key !== "branch") {
      continue;
    }

    if (value.startsWith(branchReferencePrefix)) {
      worktreeBranch = value.slice(branchReferencePrefix.length);
      continue;
    }

    worktreeBranch = value;
  }

  pushWorktree();

  return branchWorktreePath;
};

const moveGitBranch = async ({
  repoRoot,
  branch,
  oldSha,
  newSha,
}: GitMoveBranchRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", "--branch", branch],
  });
  const branchRef = `refs/heads/${branch}`;
  const branchHead = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", branchRef],
  });

  if (branchHead !== oldSha) {
    throw new Error("Branch moved. Refresh and try again.");
  }

  const targetSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${newSha}^{commit}`],
  });
  const worktreePath = await readGitWorktreePathForBranch({
    repoRoot,
    branch,
  });

  if (worktreePath === null) {
    await runGitCommandForPath({
      path: repoRoot,
      args: [
        "update-ref",
        "-m",
        `Molt Tree: move ${branch}`,
        branchRef,
        targetSha,
        oldSha,
      ],
    });
    return;
  }

  const statusText = await readGitTextForPath({
    path: worktreePath,
    args: ["status", "--porcelain"],
  });

  if (statusText.length > 0) {
    throw new Error("Working tree must be clean before moving this branch.");
  }

  const worktreeHead = await readGitTextForPath({
    path: worktreePath,
    args: ["rev-parse", "HEAD"],
  });

  if (worktreeHead !== oldSha) {
    throw new Error("Branch moved. Refresh and try again.");
  }

  await runGitCommandForPath({
    path: worktreePath,
    args: ["reset", "--keep", targetSha],
  });
};

const pushGitBranchTagChanges = async (
  gitBranchTagChanges: GitBranchTagChange[],
) => {
  for (const { repoRoot, branch, newSha } of gitBranchTagChanges) {
    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", "--branch", branch],
    });

    if (newSha === null) {
      let doesLocalBranchExist = false;

      try {
        await readGitTextForPath({
          path: repoRoot,
          args: ["rev-parse", "--verify", `refs/heads/${branch}`],
        });
        doesLocalBranchExist = true;
      } catch {
        doesLocalBranchExist = false;
      }

      if (doesLocalBranchExist) {
        throw new Error(`${branch} exists locally. Refresh and try again.`);
      }

      await runGitCommandForPath({
        path: repoRoot,
        args: ["push", "origin", "--delete", branch],
      });
      continue;
    }

    const branchRef = `refs/heads/${branch}`;
    const branchHead = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", branchRef],
    });

    if (branchHead !== newSha) {
      throw new Error(`${branch} moved. Refresh and try again.`);
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: [
        "push",
        "--force-with-lease",
        "origin",
        `${branchRef}:${branchRef}`,
      ],
    });
  }
};

const resetGitBranchTagChanges = async (
  gitBranchTagChanges: GitBranchTagChange[],
) => {
  const fetchedRepoRoots: string[] = [];

  for (const { repoRoot } of gitBranchTagChanges) {
    if (fetchedRepoRoots.includes(repoRoot)) {
      continue;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: ["fetch", "origin", "--prune"],
    });
    fetchedRepoRoots.push(repoRoot);
  }

  for (const { repoRoot, branch } of gitBranchTagChanges) {
    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", "--branch", branch],
    });

    const remoteSha = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`],
    });
    let localSha: string | null = null;

    try {
      localSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `refs/heads/${branch}`],
      });
    } catch {
      localSha = null;
    }

    if (localSha === null) {
      await runGitCommandForPath({
        path: repoRoot,
        args: ["branch", branch, remoteSha],
      });
      continue;
    }

    const worktreePath = await readGitWorktreePathForBranch({
      repoRoot,
      branch,
    });

    if (worktreePath === null) {
      await runGitCommandForPath({
        path: repoRoot,
        args: ["branch", "-f", branch, remoteSha],
      });
      continue;
    }

    const statusText = await readGitTextForPath({
      path: worktreePath,
      args: ["status", "--porcelain"],
    });

    if (statusText.length > 0) {
      throw new Error(`Working tree must be clean before resetting ${branch}.`);
    }

    const worktreeHead = await readGitTextForPath({
      path: worktreePath,
      args: ["rev-parse", "HEAD"],
    });

    if (worktreeHead !== localSha) {
      throw new Error(`${branch} moved. Refresh and try again.`);
    }

    await runGitCommandForPath({
      path: worktreePath,
      args: ["reset", "--keep", remoteSha],
    });
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

ipcMain.handle("git:commitAllChanges", async (_event, value: unknown) => {
  const gitCommitChangesRequest = readGitCommitChangesRequest(value);

  await commitAllGitChanges(gitCommitChangesRequest);
});

ipcMain.handle("git:deleteWorktree", async (_event, value: unknown) => {
  const gitDeleteWorktreeRequest = readGitDeleteWorktreeRequest(value);

  await deleteGitWorktree(gitDeleteWorktreeRequest);
});

ipcMain.handle("git:deleteBranch", async (_event, value: unknown) => {
  const gitDeleteBranchRequest = readGitDeleteBranchRequest(value);

  await deleteGitBranch(gitDeleteBranchRequest);
});

ipcMain.handle("git:moveBranch", async (_event, value: unknown) => {
  const gitMoveBranchRequest = readGitMoveBranchRequest(value);

  await moveGitBranch(gitMoveBranchRequest);
});

ipcMain.handle("git:pushBranchTagChanges", async (_event, value: unknown) => {
  const gitBranchTagChanges = readGitBranchTagChanges(value);

  await pushGitBranchTagChanges(gitBranchTagChanges);
});

ipcMain.handle("git:resetBranchTagChanges", async (_event, value: unknown) => {
  const gitBranchTagChanges = readGitBranchTagChanges(value);

  await resetGitBranchTagChanges(gitBranchTagChanges);
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
