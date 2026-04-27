import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import type {
  GitBranchTagChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitDeleteBranchRequest,
  GitMergeBranchRequest,
  GitMergePreview,
  GitMoveBranchRequest,
} from "../shared/types";
import { createAppServerClient } from "./appServerClient";
import { archiveCodexThreads } from "./codexThreads";
import { readDashboardData } from "./dashboard";

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

const readCodexThreadIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new Error("threadIds must be an array.");
  }

  const threadIds: string[] = [];

  for (const threadId of value) {
    if (typeof threadId !== "string" || threadId.length === 0) {
      throw new Error("threadIds must only contain non-empty strings.");
    }

    threadIds.push(threadId);
  }

  return threadIds;
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

const commitAllGitChanges = async ({
  path,
  message,
}: GitCommitChangesRequest) => {
  const repoRoot = await readGitTextForPath({
    path,
    args: ["rev-parse", "--show-toplevel"],
  });
  const oldSha = await readGitTextForPath({
    path,
    args: ["rev-parse", "HEAD"],
  });
  const localBranchText = await readGitTextForPath({
    path,
    args: [
      "for-each-ref",
      "--points-at",
      oldSha,
      "--format=%(refname:short)",
      "refs/heads",
    ],
  });
  const branchesToMove = localBranchText
    .split("\n")
    .filter((branch) => branch.length > 0);

  await runGitCommandForPath({ path, args: ["add", "--all", "--", "."] });
  await runGitCommandForPath({ path, args: ["commit", "-m", message] });

  const newSha = await readGitTextForPath({
    path,
    args: ["rev-parse", "HEAD"],
  });

  for (const branch of branchesToMove) {
    const branchRef = `refs/heads/${branch}`;
    const branchHead = await readGitTextForPath({
      path,
      args: ["rev-parse", "--verify", branchRef],
    });

    if (branchHead === newSha) {
      continue;
    }

    if (branchHead !== oldSha) {
      throw new Error(`${branch} moved. Refresh and try again.`);
    }

    const worktreePath = await readGitWorktreePathForBranch({
      repoRoot,
      branch,
    });

    if (worktreePath !== null) {
      continue;
    }

    await runGitCommandForPath({
      path,
      args: [
        "update-ref",
        "-m",
        `MoltTree: move ${branch}`,
        branchRef,
        newSha,
        oldSha,
      ],
    });
  }

  return newSha;
};

const createGitBranch = async ({ path, branch }: GitCreateBranchRequest) => {
  await runGitCommandForPath({
    path,
    args: ["check-ref-format", "--branch", branch],
  });
  await runGitCommandForPath({ path, args: ["branch", branch] });
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

const parseGitChangeLineCounts = (stdout: string) => {
  const lineCounts = {
    added: 0,
    removed: 0,
  };

  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [addedText, removedText] = line.split("\t");
    const added = Number(addedText);
    const removed = Number(removedText);

    if (Number.isFinite(added)) {
      lineCounts.added += added;
    }

    if (Number.isFinite(removed)) {
      lineCounts.removed += removed;
    }
  }

  return lineCounts;
};

const readGitMergeBranchRef = async ({
  repoRoot,
  branch,
}: GitMergeBranchRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", "--branch", branch],
  });

  const branchRef = `refs/heads/${branch}`;

  await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${branchRef}^{commit}`],
  });

  return branchRef;
};

const previewGitMerge = async (
  gitMergeBranchRequest: GitMergeBranchRequest,
) => {
  const branchRef = await readGitMergeBranchRef(gitMergeBranchRequest);
  const diffText = await readGitTextForPath({
    path: gitMergeBranchRequest.repoRoot,
    args: ["diff", "--numstat", `HEAD...${branchRef}`, "--", "."],
  });
  const lineCounts = parseGitChangeLineCounts(diffText);
  const mergeTreeText = await readGitTextForPath({
    path: gitMergeBranchRequest.repoRoot,
    args: [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "HEAD",
      branchRef,
    ],
  });
  const mergeTreeLines = mergeTreeText
    .split("\n")
    .filter((line) => line.length > 0);
  const conflictCount = Math.max(0, mergeTreeLines.length - 1);
  const gitMergePreview: GitMergePreview = {
    added: lineCounts.added,
    removed: lineCounts.removed,
    conflictCount,
  };

  return gitMergePreview;
};

const mergeGitBranch = async (gitMergeBranchRequest: GitMergeBranchRequest) => {
  const branchRef = await readGitMergeBranchRef(gitMergeBranchRequest);
  const statusText = await readGitTextForPath({
    path: gitMergeBranchRequest.repoRoot,
    args: ["status", "--porcelain"],
  });

  if (statusText.length > 0) {
    throw new Error("Working tree must be clean before starting a merge.");
  }

  await runGitCommandForPath({
    path: gitMergeBranchRequest.repoRoot,
    args: ["merge", "--no-edit", branchRef],
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
  const targetSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${newSha}^{commit}`],
  });

  if (branchHead === targetSha) {
    return;
  }

  if (branchHead !== oldSha) {
    throw new Error("Branch moved. Refresh and try again.");
  }

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
        `MoltTree: move ${branch}`,
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

const checkoutGitCommit = async ({
  repoRoot,
  sha,
}: GitCheckoutCommitRequest) => {
  const targetSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${sha}^{commit}`],
  });
  const currentSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "HEAD"],
  });

  if (currentSha === targetSha) {
    return;
  }

  const statusText = await readGitTextForPath({
    path: repoRoot,
    args: ["status", "--porcelain"],
  });

  if (statusText.length > 0) {
    throw new Error("Working tree must be clean before checking out a row.");
  }

  const visibleRefText = await readGitTextForPath({
    path: repoRoot,
    args: [
      "for-each-ref",
      "--contains",
      currentSha,
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ],
  });

  if (visibleRefText.length === 0) {
    throw new Error(
      "Current HEAD must be reachable from a branch or tag before switching rows.",
    );
  }

  await runGitCommandForPath({
    path: repoRoot,
    args: ["switch", "--detach", targetSha],
  });
};

const pushGitBranchTagChanges = async (
  gitBranchTagChanges: GitBranchTagChange[],
) => {
  const pushedRepoRoots: string[] = [];

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

      if (!pushedRepoRoots.includes(repoRoot)) {
        pushedRepoRoots.push(repoRoot);
      }

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

    if (!pushedRepoRoots.includes(repoRoot)) {
      pushedRepoRoots.push(repoRoot);
    }
  }

  for (const repoRoot of pushedRepoRoots) {
    await runGitCommandForPath({
      path: repoRoot,
      args: ["fetch", "origin", "--prune"],
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
  return await readDashboardDataWithoutOverlap();
});

ipcMain.handle("codex:openThread", async (_event, threadId: unknown) => {
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("threadId must be a non-empty string.");
  }

  await shell.openExternal(`codex://threads/${threadId}`);
});

ipcMain.handle("codex:archiveThreads", async (_event, value: unknown) => {
  const threadIds = readCodexThreadIds(value);
  const appServerClient = await createAppServerClient();

  try {
    await archiveCodexThreads({ appServerClient, threadIds });
  } finally {
    appServerClient.close();
  }
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
