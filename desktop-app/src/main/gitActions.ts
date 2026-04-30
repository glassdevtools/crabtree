import { simpleGit } from "simple-git";
import type {
  GitBranchSyncChange,
  GitBranchTagChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitDeleteBranchRequest,
  GitDeleteTagRequest,
  GitDetachWorktreeBranchRequest,
  GitMergeBranchRequest,
  GitMergeBranchResult,
  GitMergePreview,
  GitMoveBranchRequest,
  GitSwitchBranchRequest,
} from "../shared/types";

const FIELD_SEPARATOR = "\u001f";
const ZERO_SHA = "0000000000000000000000000000000000000000";

type GitWorktreePointer = {
  path: string;
  head: string | null;
  branch: string | null;
};

// Git actions live here so IPC can stay focused on validating inputs before calling a small surface of mutations.
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

const readNullableGitTextForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  try {
    return await readGitTextForPath({ path, args });
  } catch {
    return null;
  }
};

// -------------------------- Worktree and visibility helpers ---------------

// Worktree state matters because a checked-out branch has to move through its own worktree.
const readGitWorktrees = async ({ repoRoot }: { repoRoot: string }) => {
  const text = await readGitTextForPath({
    path: repoRoot,
    args: ["worktree", "list", "--porcelain"],
  });
  const worktrees: GitWorktreePointer[] = [];
  const branchReferencePrefix = "refs/heads/";
  let path: string | null = null;
  let head: string | null = null;
  let branch: string | null = null;

  const pushWorktree = () => {
    if (path === null) {
      return;
    }

    worktrees.push({ path, head, branch });
  };

  for (const line of text.split("\n")) {
    if (line.length === 0) {
      pushWorktree();
      path = null;
      head = null;
      branch = null;
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");

    if (key === "worktree") {
      path = value;
      continue;
    }

    if (key === "HEAD") {
      head = value === ZERO_SHA ? null : value;
      continue;
    }

    if (key !== "branch") {
      continue;
    }

    if (value.startsWith(branchReferencePrefix)) {
      branch = value.slice(branchReferencePrefix.length);
      continue;
    }

    branch = value;
  }

  pushWorktree();

  return worktrees;
};

const readGitWorktreePathForBranch = async ({
  repoRoot,
  branch,
}: {
  repoRoot: string;
  branch: string;
}) => {
  const worktrees = await readGitWorktrees({ repoRoot });

  for (const worktree of worktrees) {
    if (worktree.branch === branch) {
      return worktree.path;
    }
  }

  return null;
};

// Visibility checks answer whether an old commit will still appear in the graph after a ref changes.
const readIsShaReachableFromRootSha = async ({
  repoRoot,
  sha,
  rootSha,
}: {
  repoRoot: string;
  sha: string;
  rootSha: string;
}) => {
  if (sha === rootSha) {
    return true;
  }

  const ancestorPathText = await readGitTextForPath({
    path: repoRoot,
    args: [
      "rev-list",
      "--ancestry-path",
      "--max-count=1",
      `${sha}..${rootSha}`,
    ],
  });

  return ancestorPathText.length > 0;
};

const readVisibleRootShasAfterRefChange = async ({
  repoRoot,
  changedRef,
  replacementSha,
  changedLocalBranch,
  rootRefs,
  shouldIncludeWorktreeHeads,
}: {
  repoRoot: string;
  changedRef: string;
  replacementSha: string | null;
  changedLocalBranch: string | null;
  rootRefs: string[];
  shouldIncludeWorktreeHeads: boolean;
}) => {
  const refText = await readGitTextForPath({
    path: repoRoot,
    args: [
      "for-each-ref",
      `--format=%(objectname)${FIELD_SEPARATOR}%(refname)`,
      ...rootRefs,
    ],
  });
  const rootShas: string[] = [];

  for (const line of refText.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [sha, ref] = line.split(FIELD_SEPARATOR);

    if (sha === undefined || ref === undefined || ref === changedRef) {
      continue;
    }

    rootShas.push(sha);
  }

  if (replacementSha !== null) {
    rootShas.push(replacementSha);
  }

  if (shouldIncludeWorktreeHeads) {
    for (const worktree of await readGitWorktrees({ repoRoot })) {
      if (worktree.head === null || worktree.branch === changedLocalBranch) {
        continue;
      }

      rootShas.push(worktree.head);
    }
  }

  return rootShas;
};

// Every destructive ref change goes through this check before Git is allowed to move the ref.
const ensureOldShaStaysVisibleAfterRefChange = async ({
  repoRoot,
  oldSha,
  changedRef,
  replacementSha,
  changedLocalBranch,
  rootRefs,
  shouldIncludeWorktreeHeads,
  message,
}: {
  repoRoot: string;
  oldSha: string;
  changedRef: string;
  replacementSha: string | null;
  changedLocalBranch: string | null;
  rootRefs: string[];
  shouldIncludeWorktreeHeads: boolean;
  message: string;
}) => {
  const rootShas = await readVisibleRootShasAfterRefChange({
    repoRoot,
    changedRef,
    replacementSha,
    changedLocalBranch,
    rootRefs,
    shouldIncludeWorktreeHeads,
  });

  for (const rootSha of rootShas) {
    if (
      await readIsShaReachableFromRootSha({
        repoRoot,
        sha: oldSha,
        rootSha,
      })
    ) {
      return;
    }
  }

  throw new Error(message);
};

// -------------------------- Local working tree actions ---------------

export const stageGitChanges = async (path: string) => {
  await runGitCommandForPath({ path, args: ["add", "--all", "--", "."] });
};

export const unstageGitChanges = async (path: string) => {
  await runGitCommandForPath({
    path,
    args: ["restore", "--staged", "--", "."],
  });
};

export const commitAllGitChanges = async ({
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

  await stageGitChanges(path);
  await runGitCommandForPath({ path, args: ["commit", "-m", message] });

  const newSha = await readGitTextForPath({
    path,
    args: ["rev-parse", "HEAD"],
  });

  // The commit is complete here, so extra branch tag moves should never make the commit look failed.
  for (const branch of branchesToMove) {
    try {
      const branchRef = `refs/heads/${branch}`;
      const branchHead = await readGitTextForPath({
        path,
        args: ["rev-parse", "--verify", branchRef],
      });

      if (branchHead === newSha || branchHead !== oldSha) {
        continue;
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
    } catch {
      continue;
    }
  }

  return newSha;
};

export const createGitBranch = async ({
  path,
  branch,
}: GitCreateBranchRequest) => {
  await runGitCommandForPath({
    path,
    args: ["check-ref-format", "--branch", branch],
  });
  await runGitCommandForPath({ path, args: ["switch", "-c", branch] });
};

// Branches and tags share this path so both delete actions get the same stale-ref check.
const deleteGitRef = async ({
  repoRoot,
  refName,
  gitRef,
  oldSha,
}: {
  repoRoot: string;
  refName: string;
  gitRef: string;
  oldSha: string;
}) => {
  const expectedOldSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${oldSha}^{commit}`],
  });
  const refHead = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", gitRef],
  });
  const refCommit = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${gitRef}^{commit}`],
  });

  if (refCommit !== expectedOldSha) {
    throw new Error(`${refName} moved. Refresh and try again.`);
  }

  await runGitCommandForPath({
    path: repoRoot,
    args: [
      "update-ref",
      "-m",
      `MoltTree: delete ${refName}`,
      "-d",
      gitRef,
      refHead,
    ],
  });
};

// Branch and tag deletion need an old sha because deleting a stale ref can hide commits the user did not mean to touch.
export const deleteGitBranch = async ({
  repoRoot,
  branch,
  oldSha,
}: GitDeleteBranchRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", "--branch", branch],
  });

  const worktreePath = await readGitWorktreePathForBranch({
    repoRoot,
    branch,
  });

  if (worktreePath !== null) {
    throw new Error(
      "This branch is checked out in a worktree. Switch or detach that worktree before deleting it.",
    );
  }

  await deleteGitRef({
    repoRoot,
    refName: branch,
    gitRef: `refs/heads/${branch}`,
    oldSha,
  });
};

export const deleteGitTag = async ({
  repoRoot,
  tag,
  oldSha,
}: GitDeleteTagRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", `refs/tags/${tag}`],
  });

  await deleteGitRef({
    repoRoot,
    refName: tag,
    gitRef: `refs/tags/${tag}`,
    oldSha,
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

// -------------------------- Merge actions ---------------

const readGitMergeBranchTarget = async ({
  repoRoot,
  branch,
}: GitMergeBranchRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", "--branch", branch],
  });

  const branchRef = `refs/heads/${branch}`;
  const currentBranch = await readGitTextForPath({
    path: repoRoot,
    args: ["branch", "--show-current"],
  });

  if (currentBranch.length === 0) {
    throw new Error("HEAD must be on a branch before merging.");
  }

  const branchHead = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${branchRef}^{commit}`],
  });
  const headSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "HEAD"],
  });

  // The renderer hides these, and the Git action rejects stale calls for the same graph rule.
  if (
    await readIsShaReachableFromRootSha({
      repoRoot,
      sha: branchHead,
      rootSha: headSha,
    })
  ) {
    throw new Error("This branch is already in HEAD.");
  }

  return { branchRef, currentBranch, oldSha: headSha };
};

export const previewGitMerge = async (
  gitMergeBranchRequest: GitMergeBranchRequest,
) => {
  const { branchRef } = await readGitMergeBranchTarget(gitMergeBranchRequest);
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

export const mergeGitBranch = async (
  gitMergeBranchRequest: GitMergeBranchRequest,
): Promise<GitMergeBranchResult> => {
  const { branchRef, currentBranch, oldSha } = await readGitMergeBranchTarget(
    gitMergeBranchRequest,
  );
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

  const newSha = await readGitTextForPath({
    path: gitMergeBranchRequest.repoRoot,
    args: ["rev-parse", "--verify", "HEAD"],
  });

  return {
    repoRoot: gitMergeBranchRequest.repoRoot,
    branch: currentBranch,
    oldSha,
    newSha,
  };
};

// -------------------------- Branch pointer and checkout actions ---------------

export const moveGitBranch = async ({
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
  const expectedOldSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${oldSha}^{commit}`],
  });
  const targetSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${newSha}^{commit}`],
  });

  if (branchHead === targetSha) {
    return;
  }

  if (branchHead !== expectedOldSha) {
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
        expectedOldSha,
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

  if (worktreeHead !== expectedOldSha) {
    throw new Error("Branch moved. Refresh and try again.");
  }

  await runGitCommandForPath({
    path: worktreePath,
    args: ["reset", "--keep", targetSha],
  });
};

export const switchGitBranch = async ({
  repoRoot,
  path,
  branch,
  oldSha,
  newSha,
}: GitSwitchBranchRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", "--branch", branch],
  });
  const branchRef = `refs/heads/${branch}`;
  const worktreePath = await readGitTextForPath({
    path,
    args: ["rev-parse", "--show-toplevel"],
  });
  const branchHead = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", branchRef],
  });
  const expectedOldSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${oldSha}^{commit}`],
  });
  const targetSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${newSha}^{commit}`],
  });

  if (branchHead !== expectedOldSha && branchHead !== targetSha) {
    throw new Error("Branch moved. Refresh and try again.");
  }

  const checkedOutWorktreePath = await readGitWorktreePathForBranch({
    repoRoot,
    branch,
  });

  if (
    checkedOutWorktreePath !== null &&
    checkedOutWorktreePath !== worktreePath
  ) {
    throw new Error("Branch is checked out in another worktree.");
  }

  if (branchHead !== targetSha) {
    if (checkedOutWorktreePath === worktreePath) {
      await runGitCommandForPath({
        path: worktreePath,
        args: ["reset", "--keep", targetSha],
      });
      return;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: [
        "update-ref",
        "-m",
        `MoltTree: move ${branch}`,
        branchRef,
        targetSha,
        expectedOldSha,
      ],
    });
  }

  await runGitCommandForPath({ path: worktreePath, args: ["switch", branch] });
};

export const detachGitWorktreeBranch = async ({
  repoRoot,
  path,
  branch,
  sha,
}: GitDetachWorktreeBranchRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", "--branch", branch],
  });
  const worktreePath = await readGitTextForPath({
    path,
    args: ["rev-parse", "--show-toplevel"],
  });
  const checkedOutWorktreePath = await readGitWorktreePathForBranch({
    repoRoot,
    branch,
  });

  if (checkedOutWorktreePath !== worktreePath) {
    throw new Error("Branch moved. Refresh and try again.");
  }

  const expectedSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${sha}^{commit}`],
  });
  const branchHead = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `refs/heads/${branch}`],
  });
  const worktreeHead = await readGitTextForPath({
    path: worktreePath,
    args: ["rev-parse", "HEAD"],
  });

  if (branchHead !== expectedSha || worktreeHead !== expectedSha) {
    throw new Error("Branch moved. Refresh and try again.");
  }

  await runGitCommandForPath({
    path: worktreePath,
    args: ["switch", "--detach", expectedSha],
  });
};

export const checkoutGitCommit = async ({
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

// -------------------------- Origin branch sync actions ---------------

export const pushGitBranchSyncChanges = async (
  gitBranchSyncChanges: GitBranchSyncChange[],
) => {
  const fetchedRepoRoots: string[] = [];
  const pushedRepoRoots: string[] = [];

  for (const { repoRoot } of gitBranchSyncChanges) {
    if (fetchedRepoRoots.includes(repoRoot)) {
      continue;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: ["fetch", "origin", "--prune"],
    });
    fetchedRepoRoots.push(repoRoot);
  }

  for (const {
    repoRoot,
    branch,
    localSha,
    originSha,
  } of gitBranchSyncChanges) {
    if (localSha === null || localSha === ZERO_SHA || originSha === ZERO_SHA) {
      continue;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", "--branch", branch],
    });

    const branchRef = `refs/heads/${branch}`;
    const originBranchRef = `refs/remotes/origin/${branch}`;
    const remoteBranchRef = `refs/heads/${branch}`;
    const targetSha = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", `${localSha}^{commit}`],
    });
    const branchHead = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", branchRef],
    });

    if (branchHead !== targetSha) {
      throw new Error(`${branch} moved. Refresh and try again.`);
    }

    if (originSha !== null) {
      const expectedOriginSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `${originSha}^{commit}`],
      });
      const originHead = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", originBranchRef],
      });

      if (originHead !== expectedOriginSha) {
        throw new Error(`${branch} moved. Refresh and try again.`);
      }

      await ensureOldShaStaysVisibleAfterRefChange({
        repoRoot,
        oldSha: expectedOriginSha,
        changedRef: originBranchRef,
        replacementSha: targetSha,
        changedLocalBranch: null,
        rootRefs: ["refs/remotes/origin"],
        shouldIncludeWorktreeHeads: false,
        message:
          "Pushing this branch update would hide commits from the graph. Move or tag another branch first.",
      });
    } else {
      const originHead = await readNullableGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", originBranchRef],
      });

      if (originHead !== null) {
        throw new Error(`${branch} moved. Refresh and try again.`);
      }
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: [
        "push",
        `--force-with-lease=${remoteBranchRef}:${originSha ?? ""}`,
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

export const revertGitBranchSyncChanges = async (
  gitBranchSyncChanges: GitBranchSyncChange[],
) => {
  const fetchedRepoRoots: string[] = [];

  for (const { repoRoot } of gitBranchSyncChanges) {
    if (fetchedRepoRoots.includes(repoRoot)) {
      continue;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: ["fetch", "origin", "--prune"],
    });
    fetchedRepoRoots.push(repoRoot);
  }

  for (const {
    repoRoot,
    branch,
    localSha,
    originSha,
  } of gitBranchSyncChanges) {
    if (
      localSha === null ||
      originSha === null ||
      localSha === ZERO_SHA ||
      originSha === ZERO_SHA
    ) {
      continue;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", "--branch", branch],
    });

    const branchRef = `refs/heads/${branch}`;
    const remoteSha = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", `${originSha}^{commit}`],
    });
    const remoteHead = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", `refs/remotes/origin/${branch}`],
    });
    let currentLocalSha: string | null = null;

    if (remoteHead !== remoteSha) {
      throw new Error(`${branch} moved. Refresh and try again.`);
    }

    try {
      currentLocalSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", branchRef],
      });
    } catch {
      currentLocalSha = null;
    }

    if (currentLocalSha !== localSha) {
      throw new Error(`${branch} moved. Refresh and try again.`);
    }

    await ensureOldShaStaysVisibleAfterRefChange({
      repoRoot,
      oldSha: currentLocalSha,
      changedRef: branchRef,
      replacementSha: remoteSha,
      changedLocalBranch: branch,
      rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
      shouldIncludeWorktreeHeads: true,
      message:
        "Resetting this branch would hide commits from the graph. Move or tag another branch first.",
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
          `MoltTree: reset ${branch}`,
          branchRef,
          remoteSha,
          currentLocalSha,
        ],
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

    if (worktreeHead !== currentLocalSha) {
      throw new Error(`${branch} moved. Refresh and try again.`);
    }

    await runGitCommandForPath({
      path: worktreePath,
      args: ["reset", "--keep", remoteSha],
    });
  }
};
