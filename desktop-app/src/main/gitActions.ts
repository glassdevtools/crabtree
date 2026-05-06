import { simpleGit } from "simple-git";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitBranchSyncChange,
  GitBranchTagChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitDiff,
  GitDiffFile,
  GitDiffRequest,
  GitCreatePullRequestRequest,
  GitCreateRefRequest,
  GitDeleteBranchRequest,
  GitDeleteTagRequest,
  GitMergeBranchRequest,
  GitMergeBranchResult,
  GitMergePreview,
  GitMoveBranchRequest,
  GitMoveTagRequest,
  GitSwitchBranchRequest,
} from "../shared/types";

const FIELD_SEPARATOR = "\u001f";
const ZERO_SHA = "0000000000000000000000000000000000000000";
// TODO: AI-PICKED-VALUE: This prevents Git mutations and remote reads from waiting forever on a blocked process.
const GIT_COMMAND_TIMEOUT_MS = 20_000;
// TODO: AI-PICKED-VALUE: This lets large untracked-file diffs render without letting one IPC read consume unbounded memory.
const GIT_DIFF_MAX_BUFFER_BYTE_COUNT = 50 * 1024 * 1024;
const execFileAsync = promisify(execFile);

type GitWorktreePointer = {
  path: string;
  head: string | null;
  branch: string | null;
};

// Git actions live here so IPC can stay focused on validating inputs before calling a small surface of mutations.
const createGitClientForPath = ({ path }: { path: string }) => {
  return simpleGit({
    baseDir: path,
    timeout: { block: GIT_COMMAND_TIMEOUT_MS },
  }).env("GIT_TERMINAL_PROMPT", "0");
};

const runGitCommandForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  await createGitClientForPath({ path }).raw(args);
};

const readGitRawTextForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  return await createGitClientForPath({ path }).raw(args);
};

const readGitTextForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  return (await readGitRawTextForPath({ path, args })).trim();
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

const runGitHubCliForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: path,
    encoding: "utf8",
  });

  return stdout.trim();
};

const readDefaultBranchNameFromOriginHeadText = (originHeadText: string) => {
  const originPrefix = "origin/";

  if (originHeadText.startsWith(originPrefix)) {
    return originHeadText.slice(originPrefix.length);
  }

  for (const line of originHeadText.split("\n")) {
    const remoteHeadPrefix = "ref: refs/heads/";

    if (!line.startsWith(remoteHeadPrefix)) {
      continue;
    }

    return line.slice(remoteHeadPrefix.length).split("\t")[0] ?? null;
  }

  return originHeadText;
};

const readLocalDefaultBranch = async ({ repoRoot }: { repoRoot: string }) => {
  const originHead = await readNullableGitTextForPath({
    path: repoRoot,
    args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
  });

  return originHead === null
    ? null
    : readDefaultBranchNameFromOriginHeadText(originHead);
};

const readDefaultBranch = async ({ repoRoot }: { repoRoot: string }) => {
  const localDefaultBranch = await readLocalDefaultBranch({ repoRoot });

  if (localDefaultBranch !== null) {
    return localDefaultBranch;
  }

  const remoteOriginHead = await readNullableGitTextForPath({
    path: repoRoot,
    args: ["ls-remote", "--symref", "origin", "HEAD"],
  });

  return remoteOriginHead === null
    ? null
    : readDefaultBranchNameFromOriginHeadText(remoteOriginHead);
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

const readCurrentBranch = async ({ repoRoot }: { repoRoot: string }) => {
  const branch = await readGitTextForPath({
    path: repoRoot,
    args: ["branch", "--show-current"],
  });

  return branch.length === 0 ? null : branch;
};

type GitBranchCheckoutPlace = "head" | "worktree";

const readGitBranchCheckoutPlace = async ({
  repoRoot,
  branch,
}: {
  repoRoot: string;
  branch: string;
}) => {
  const currentBranch = await readCurrentBranch({ repoRoot });

  if (branch === currentBranch) {
    return "head";
  }

  const worktrees = await readGitWorktrees({ repoRoot });

  for (const worktree of worktrees) {
    if (worktree.branch === branch) {
      return "worktree";
    }
  }

  return null;
};

const detachHeadFromCurrentBranch = async ({
  repoRoot,
  expectedHeadSha,
}: {
  repoRoot: string;
  expectedHeadSha: string;
}) => {
  const headSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "HEAD"],
  });

  if (headSha !== expectedHeadSha) {
    throw new Error("HEAD moved. Refresh and try again.");
  }

  await runGitCommandForPath({
    path: repoRoot,
    args: ["switch", "--detach", expectedHeadSha],
  });
};

const detachWorktreeHeadAtSha = async ({
  path,
  expectedHeadSha,
  branch,
}: {
  path: string;
  expectedHeadSha: string;
  branch: string;
}) => {
  const headSha = await readGitTextForPath({
    path,
    args: ["rev-parse", "HEAD"],
  });

  if (headSha !== expectedHeadSha) {
    throw new Error("HEAD moved. Refresh and try again.");
  }

  await runGitCommandForPath({
    path,
    args: [
      "update-ref",
      "--no-deref",
      "-m",
      `Crabtree: detach HEAD from ${branch}`,
      "HEAD",
      expectedHeadSha,
    ],
  });
};

const attachWorktreeHeadToBranch = async ({
  path,
  branch,
  expectedHeadSha,
}: {
  path: string;
  branch: string;
  expectedHeadSha: string;
}) => {
  const headSha = await readGitTextForPath({
    path,
    args: ["rev-parse", "HEAD"],
  });

  if (headSha !== expectedHeadSha) {
    throw new Error("HEAD moved. Refresh and try again.");
  }

  await runGitCommandForPath({
    path,
    args: [
      "symbolic-ref",
      "-m",
      `Crabtree: attach HEAD to ${branch}`,
      "HEAD",
      `refs/heads/${branch}`,
    ],
  });
};

const readLocalBranchesAtSha = async ({
  repoRoot,
  sha,
}: {
  repoRoot: string;
  sha: string;
}) => {
  const localBranchText = await readGitTextForPath({
    path: repoRoot,
    args: [
      "for-each-ref",
      "--sort=refname",
      "--points-at",
      sha,
      "--format=%(refname:short)",
      "refs/heads",
    ],
  });

  return localBranchText.split("\n").filter((branch) => branch.length > 0);
};

// Detached HEAD should reattach when a local branch already points at the same commit.
const readAvailableLocalBranchAtSha = async ({
  repoRoot,
  sha,
}: {
  repoRoot: string;
  sha: string;
}) => {
  const localBranches = await readLocalBranchesAtSha({ repoRoot, sha });

  if (localBranches.length === 0) {
    return null;
  }

  const worktrees = await readGitWorktrees({ repoRoot });
  const isCheckedOutBranchOfBranch: { [branch: string]: boolean } = {};

  for (const worktree of worktrees) {
    if (worktree.branch !== null) {
      isCheckedOutBranchOfBranch[worktree.branch] = true;
    }
  }

  const localDefaultBranch = await readLocalDefaultBranch({ repoRoot });

  if (
    localDefaultBranch !== null &&
    localBranches.includes(localDefaultBranch) &&
    isCheckedOutBranchOfBranch[localDefaultBranch] !== true
  ) {
    return localDefaultBranch;
  }

  for (const localBranch of localBranches) {
    if (isCheckedOutBranchOfBranch[localBranch] !== true) {
      return localBranch;
    }
  }

  return null;
};

const attachHeadToLocalBranchAtCurrentSha = async ({
  repoRoot,
}: {
  repoRoot: string;
}) => {
  const currentBranch = await readCurrentBranch({ repoRoot });

  if (currentBranch !== null) {
    return;
  }

  const headSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "HEAD"],
  });
  const branch = await readAvailableLocalBranchAtSha({
    repoRoot,
    sha: headSha,
  });

  if (branch === null) {
    return;
  }

  await runGitCommandForPath({ path: repoRoot, args: ["switch", branch] });
};

export const readGitMainWorktreePathForPath = async ({
  path,
}: {
  path: string;
}) => {
  const worktrees = await readGitWorktrees({ repoRoot: path });
  const mainWorktree = worktrees[0];

  if (mainWorktree === undefined) {
    throw new Error("Git worktree list did not include a main worktree.");
  }

  return mainWorktree.path;
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

const readIsMergeInProgress = async ({ path }: { path: string }) => {
  const mergeHead = await readNullableGitTextForPath({
    path,
    args: ["rev-parse", "--verify", "MERGE_HEAD"],
  });

  return mergeHead !== null;
};

const readGitDiffFilesForText = ({
  diffText,
  section,
}: {
  diffText: string;
  section: string | null;
}) => {
  const files: GitDiffFile[] = [];
  let currentPath = "";
  let currentDiffLines: string[] = [];

  const readGitDiffPathFromHeader = (line: string) => {
    const combinedDiffPrefixes = ["diff --cc ", "diff --combined "];

    for (const combinedDiffPrefix of combinedDiffPrefixes) {
      if (line.startsWith(combinedDiffPrefix)) {
        return line.slice(combinedDiffPrefix.length);
      }
    }

    const newPathPrefix = " b/";
    const newPathIndex = line.indexOf(newPathPrefix);

    if (newPathIndex === -1) {
      return "Changed file";
    }

    return line.slice(newPathIndex + newPathPrefix.length);
  };

  const pushCurrentFile = () => {
    if (currentDiffLines.length === 0) {
      return;
    }

    files.push({
      path: currentPath,
      section,
      diff: currentDiffLines.join("\n"),
    });
  };

  for (const line of diffText.trimEnd().split("\n")) {
    if (line.length === 0 && currentDiffLines.length === 0) {
      continue;
    }

    if (
      line.startsWith("diff --git ") ||
      line.startsWith("diff --cc ") ||
      line.startsWith("diff --combined ")
    ) {
      pushCurrentFile();
      currentPath = readGitDiffPathFromHeader(line);
      currentDiffLines = [line];
      continue;
    }

    if (currentDiffLines.length > 0) {
      currentDiffLines.push(line);
    }
  }

  pushCurrentFile();

  return files;
};

const readUntrackedGitDiffFilesForPath = async ({
  path,
  section,
}: {
  path: string;
  section: string | null;
}) => {
  // Untracked files are outside normal Git diff output, so each one is compared with an empty path.
  const readGitNoIndexDiffTextForPath = async ({
    untrackedPath,
  }: {
    untrackedPath: string;
  }) => {
    const emptyPath = process.platform === "win32" ? "NUL" : "/dev/null";

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--no-index", "--", emptyPath, untrackedPath],
        {
          cwd: path,
          encoding: "utf8",
          maxBuffer: GIT_DIFF_MAX_BUFFER_BYTE_COUNT,
        },
      );

      return stdout;
    } catch (error) {
      if (typeof error === "object" && error !== null && "stdout" in error) {
        const { stdout } = error;

        if (typeof stdout === "string") {
          return stdout;
        }
      }

      throw error;
    }
  };

  const untrackedPathText = await readGitRawTextForPath({
    path,
    args: ["ls-files", "--others", "--exclude-standard", "-z", "--", "."],
  });
  const files: GitDiffFile[] = [];

  for (const untrackedPath of untrackedPathText.split("\0")) {
    if (untrackedPath.length === 0) {
      continue;
    }

    files.push(
      ...readGitDiffFilesForText({
        diffText: await readGitNoIndexDiffTextForPath({ untrackedPath }),
        section,
      }),
    );
  }

  return files;
};

export const readGitDiff = async (
  gitDiffRequest: GitDiffRequest,
): Promise<GitDiff> => {
  switch (gitDiffRequest.target.type) {
    case "commit": {
      const args =
        gitDiffRequest.mode === "changesMadeHere"
          ? [
              "show",
              "--format=",
              "--find-renames",
              "--patch",
              "--no-ext-diff",
              gitDiffRequest.target.sha,
              "--",
              ".",
            ]
          : [
              "diff",
              "--find-renames",
              "--patch",
              "--no-ext-diff",
              "HEAD",
              gitDiffRequest.target.sha,
              "--",
              ".",
            ];
      const diffText = await readGitRawTextForPath({
        path: gitDiffRequest.target.repoRoot,
        args,
      });

      return {
        files: readGitDiffFilesForText({ diffText, section: null }),
      };
    }
    case "path": {
      const { path } = gitDiffRequest.target;

      if (gitDiffRequest.mode === "changesMadeHere") {
        // This mode mirrors the working tree state by keeping staged and unstaged patches separate.
        const [stagedDiffText, unstagedDiffText, untrackedDiffFiles] =
          await Promise.all([
            readGitRawTextForPath({
              path,
              args: [
                "diff",
                "--cached",
                "--find-renames",
                "--patch",
                "--no-ext-diff",
                "--",
                ".",
              ],
            }),
            readGitRawTextForPath({
              path,
              args: [
                "diff",
                "--find-renames",
                "--patch",
                "--no-ext-diff",
                "--",
                ".",
              ],
            }),
            readUntrackedGitDiffFilesForPath({ path, section: "Unstaged" }),
          ]);

        return {
          files: [
            ...readGitDiffFilesForText({
              diffText: stagedDiffText,
              section: "Staged",
            }),
            ...readGitDiffFilesForText({
              diffText: unstagedDiffText,
              section: "Unstaged",
            }),
            ...untrackedDiffFiles,
          ],
        };
      }

      // Diffing against HEAD uses Git's combined tracked diff, then appends untracked file patches.
      const [diffText, untrackedDiffFiles] = await Promise.all([
        readGitRawTextForPath({
          path,
          args: [
            "diff",
            "--find-renames",
            "--patch",
            "--no-ext-diff",
            "HEAD",
            "--",
            ".",
          ],
        }),
        readUntrackedGitDiffFilesForPath({ path, section: null }),
      ]);

      return {
        files: [
          ...readGitDiffFilesForText({ diffText, section: null }),
          ...untrackedDiffFiles,
        ],
      };
    }
  }
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
  const branchesToMove = await readLocalBranchesAtSha({
    repoRoot,
    sha: oldSha,
  });

  // During a merge, Git expects the index to contain the resolved files.
  // Staging the whole tree here can pull unrelated work into the merge commit.
  if (!(await readIsMergeInProgress({ path }))) {
    await stageGitChanges(path);
  }

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
          `Crabtree: move ${branch}`,
          branchRef,
          newSha,
          oldSha,
        ],
      });
    } catch {
      continue;
    }
  }

  await attachHeadToLocalBranchAtCurrentSha({ repoRoot });

  return newSha;
};

const createGitRefAtTargetSha = async ({
  path,
  name,
  gitRef,
  targetSha,
}: {
  path: string;
  name: string;
  gitRef: string;
  targetSha: string;
}) => {
  const existingRef = await readNullableGitTextForPath({
    path,
    args: ["rev-parse", "--verify", gitRef],
  });

  if (existingRef !== null) {
    throw new Error(`${name} already exists.`);
  }

  await runGitCommandForPath({
    path,
    args: [
      "update-ref",
      "-m",
      `Crabtree: create ${name}`,
      gitRef,
      targetSha,
      ZERO_SHA,
    ],
  });
};

export const createGitBranch = async ({
  path,
  branch,
  expectedHeadSha,
}: GitCreateBranchRequest) => {
  await runGitCommandForPath({
    path,
    args: ["check-ref-format", "--branch", branch],
  });

  const targetSha = await readGitTextForPath({
    path,
    args: ["rev-parse", "--verify", `${expectedHeadSha}^{commit}`],
  });
  const headSha = await readGitTextForPath({
    path,
    args: ["rev-parse", "--verify", "HEAD^{commit}"],
  });

  if (headSha !== targetSha) {
    throw new Error("HEAD moved. Refresh and try again.");
  }

  await createGitRefAtTargetSha({
    path,
    name: branch,
    gitRef: `refs/heads/${branch}`,
    targetSha,
  });
  await attachWorktreeHeadToBranch({
    path,
    branch,
    expectedHeadSha: targetSha,
  });
};

export const createGitRef = async ({
  repoRoot,
  gitRefType,
  name,
  sha,
}: GitCreateRefRequest) => {
  const gitRef =
    gitRefType === "branch" ? `refs/heads/${name}` : `refs/tags/${name}`;

  if (gitRefType === "branch") {
    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", "--branch", name],
    });
  } else {
    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", gitRef],
    });
  }

  const targetSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${sha}^{commit}`],
  });

  await createGitRefAtTargetSha({
    path: repoRoot,
    name,
    gitRef,
    targetSha,
  });
};

const readVerifiedGitRefForChange = async ({
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

  return { expectedOldSha, refHead };
};

const deleteVerifiedGitRef = async ({
  repoRoot,
  refName,
  gitRef,
  refHead,
}: {
  repoRoot: string;
  refName: string;
  gitRef: string;
  refHead: string;
}) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: [
      "update-ref",
      "-m",
      `Crabtree: delete ${refName}`,
      "-d",
      gitRef,
      refHead,
    ],
  });
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
  const { refHead } = await readVerifiedGitRefForChange({
    repoRoot,
    refName,
    gitRef,
    oldSha,
  });

  await deleteVerifiedGitRef({ repoRoot, refName, gitRef, refHead });
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

  if (branch === (await readDefaultBranch({ repoRoot }))) {
    throw new Error("This is the default branch, so you can't delete it.");
  }

  const checkoutPlace = await readGitBranchCheckoutPlace({
    repoRoot,
    branch,
  });

  if (checkoutPlace === "worktree") {
    // A checked-out branch can only detach through the worktree that owns it.
    const checkedOutWorktreePath = await readGitWorktreePathForBranch({
      repoRoot,
      branch,
    });

    if (checkedOutWorktreePath === null) {
      throw new Error("Branch moved. Refresh and try again.");
    }

    await deleteGitBranch({
      repoRoot: checkedOutWorktreePath,
      branch,
      oldSha,
    });
    return;
  }

  const gitRef = `refs/heads/${branch}`;
  const { expectedOldSha, refHead } = await readVerifiedGitRefForChange({
    repoRoot,
    refName: branch,
    gitRef,
    oldSha,
  });

  if (checkoutPlace === "head") {
    await detachHeadFromCurrentBranch({
      repoRoot,
      expectedHeadSha: expectedOldSha,
    });
  }

  await deleteVerifiedGitRef({
    repoRoot,
    refName: branch,
    gitRef,
    refHead,
  });

  if (checkoutPlace === "head") {
    await attachHeadToLocalBranchAtCurrentSha({ repoRoot });
  }
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

// -------------------------- GitHub pull request actions ---------------

// PR creation checks the origin refs first so GitHub CLI never starts from stale row data.
const readOriginBranchCommitSha = async ({
  repoRoot,
  branch,
  label,
}: {
  repoRoot: string;
  branch: string;
  label: string;
}) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", "--branch", branch],
  });

  const sha = await readNullableGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`],
  });

  if (sha === null) {
    throw new Error(`${label} branch must exist on origin.`);
  }

  return sha;
};

const readPullRequestUrlFromGithubCliText = (text: string) => {
  for (const value of text.split(/\s+/)) {
    if (value.startsWith("https://") || value.startsWith("http://")) {
      return value;
    }
  }

  return null;
};

export const createGitPullRequest = async ({
  repoRoot,
  baseBranch,
  headBranch,
  headSha,
  title,
  description,
}: GitCreatePullRequestRequest) => {
  if (baseBranch === headBranch) {
    throw new Error("Pull request branches must be different.");
  }

  const expectedHeadSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${headSha}^{commit}`],
  });
  const pushedHeadSha = await readOriginBranchCommitSha({
    repoRoot,
    branch: headBranch,
    label: "Head",
  });

  if (pushedHeadSha !== expectedHeadSha) {
    throw new Error(`${headBranch} moved. Refresh and try again.`);
  }

  await readOriginBranchCommitSha({
    repoRoot,
    branch: baseBranch,
    label: "Base",
  });

  const text = await runGitHubCliForPath({
    path: repoRoot,
    args: [
      "pr",
      "create",
      "--base",
      baseBranch,
      "--head",
      headBranch,
      "--title",
      title,
      "--body",
      description,
    ],
  });
  const pullRequestUrl = readPullRequestUrlFromGithubCliText(text);

  if (pullRequestUrl === null) {
    throw new Error("GitHub did not return a pull request URL.");
  }

  return pullRequestUrl;
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
  targetPath,
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

  if (branchHead !== expectedOldSha) {
    throw new Error("Branch moved. Refresh and try again.");
  }

  const checkedOutWorktreePath = await readGitWorktreePathForBranch({
    repoRoot,
    branch,
  });
  const worktreePathToDetach =
    checkedOutWorktreePath !== null && checkedOutWorktreePath !== targetPath
      ? checkedOutWorktreePath
      : null;

  if (worktreePathToDetach !== null) {
    await detachWorktreeHeadAtSha({
      path: worktreePathToDetach,
      expectedHeadSha: expectedOldSha,
      branch,
    });
  }

  if (branchHead !== targetSha) {
    await runGitCommandForPath({
      path: repoRoot,
      args: [
        "update-ref",
        "-m",
        `Crabtree: move ${branch}`,
        branchRef,
        targetSha,
        expectedOldSha,
      ],
    });
  }

  if (targetPath !== null) {
    await attachWorktreeHeadToBranch({
      path: targetPath,
      branch,
      expectedHeadSha: targetSha,
    });
  }
};

export const moveGitTag = async ({
  repoRoot,
  tag,
  oldSha,
  newSha,
}: GitMoveTagRequest) => {
  await runGitCommandForPath({
    path: repoRoot,
    args: ["check-ref-format", `refs/tags/${tag}`],
  });
  const tagRef = `refs/tags/${tag}`;
  const { expectedOldSha, refHead } = await readVerifiedGitRefForChange({
    repoRoot,
    refName: tag,
    gitRef: tagRef,
    oldSha,
  });
  const targetSha = await readGitTextForPath({
    path: repoRoot,
    args: ["rev-parse", "--verify", `${newSha}^{commit}`],
  });

  if (expectedOldSha === targetSha) {
    return;
  }

  await runGitCommandForPath({
    path: repoRoot,
    args: [
      "update-ref",
      "-m",
      `Crabtree: move ${tag}`,
      tagRef,
      targetSha,
      refHead,
    ],
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
    await detachWorktreeHeadAtSha({
      path: checkedOutWorktreePath,
      expectedHeadSha: branchHead,
      branch,
    });
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
        `Crabtree: move ${branch}`,
        branchRef,
        targetSha,
        expectedOldSha,
      ],
    });
  }

  await runGitCommandForPath({ path: worktreePath, args: ["switch", branch] });
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
    await attachHeadToLocalBranchAtCurrentSha({ repoRoot });
    return;
  }

  const statusText = await readGitTextForPath({
    path: repoRoot,
    args: ["status", "--porcelain"],
  });

  if (statusText.length > 0) {
    throw new Error("Working tree must be clean before switching away.");
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
      "Current HEAD must be reachable from a branch or tag before switching away.",
    );
  }

  const branch = await readAvailableLocalBranchAtSha({
    repoRoot,
    sha: targetSha,
  });

  if (branch !== null) {
    await runGitCommandForPath({ path: repoRoot, args: ["switch", branch] });
    return;
  }

  await runGitCommandForPath({
    path: repoRoot,
    args: ["switch", "--detach", targetSha],
  });
};

// -------------------------- Origin ref sync actions ---------------

const readRemoteTagSha = async ({
  repoRoot,
  tag,
}: {
  repoRoot: string;
  tag: string;
}) => {
  const remoteTagText = await readNullableGitTextForPath({
    path: repoRoot,
    args: ["ls-remote", "--tags", "origin", `refs/tags/${tag}`],
  });

  if (remoteTagText === null) {
    return null;
  }

  for (const line of remoteTagText.split("\n")) {
    const [remoteSha, remoteRef] = line.split("\t");

    if (remoteSha === undefined || remoteRef !== `refs/tags/${tag}`) {
      continue;
    }

    return remoteSha;
  }

  return null;
};

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
      args: ["fetch", "origin", "--prune", "--no-tags"],
    });
    fetchedRepoRoots.push(repoRoot);
  }

  for (const {
    repoRoot,
    gitRefType,
    name,
    localSha,
    originSha,
  } of gitBranchSyncChanges) {
    if (localSha === ZERO_SHA || originSha === ZERO_SHA) {
      continue;
    }

    if (gitRefType === "tag") {
      await runGitCommandForPath({
        path: repoRoot,
        args: ["check-ref-format", `refs/tags/${name}`],
      });

      const tagRef = `refs/tags/${name}`;
      const remoteTagSha = await readRemoteTagSha({ repoRoot, tag: name });

      if (localSha === null) {
        if (originSha === null) {
          continue;
        }

        const localTagSha = await readNullableGitTextForPath({
          path: repoRoot,
          args: ["rev-parse", "--verify", tagRef],
        });

        if (
          remoteTagSha !== originSha ||
          (localTagSha !== null && localTagSha !== originSha)
        ) {
          throw new Error(`${name} moved. Refresh and try again.`);
        }

        if (localTagSha !== null) {
          continue;
        }

        await runGitCommandForPath({
          path: repoRoot,
          args: ["fetch", "origin", "--no-tags", `${tagRef}:${tagRef}`],
        });

        continue;
      }

      const tagHead = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", tagRef],
      });

      if (tagHead !== localSha || remoteTagSha !== originSha) {
        throw new Error(`${name} moved. Refresh and try again.`);
      }

      await runGitCommandForPath({
        path: repoRoot,
        args: [
          "push",
          `--force-with-lease=${tagRef}:${originSha ?? ""}`,
          "origin",
          `${tagRef}:${tagRef}`,
        ],
      });

      continue;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", "--branch", name],
    });

    const branchRef = `refs/heads/${name}`;
    const originBranchRef = `refs/remotes/origin/${name}`;
    const remoteBranchRef = `refs/heads/${name}`;

    if (localSha === null) {
      if (originSha === null) {
        continue;
      }

      const expectedOriginSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `${originSha}^{commit}`],
      });
      const originHead = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", originBranchRef],
      });
      const branchHead = await readNullableGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", branchRef],
      });

      if (originHead !== expectedOriginSha || branchHead !== null) {
        throw new Error(`${name} moved. Refresh and try again.`);
      }

      await runGitCommandForPath({
        path: repoRoot,
        args: [
          "push",
          `--force-with-lease=${remoteBranchRef}:${expectedOriginSha}`,
          "origin",
          `:${remoteBranchRef}`,
        ],
      });

      if (!pushedRepoRoots.includes(repoRoot)) {
        pushedRepoRoots.push(repoRoot);
      }

      continue;
    }

    const targetSha = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", `${localSha}^{commit}`],
    });
    const branchHead = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", branchRef],
    });

    if (branchHead !== targetSha) {
      throw new Error(`${name} moved. Refresh and try again.`);
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
        throw new Error(`${name} moved. Refresh and try again.`);
      }
    } else {
      const originHead = await readNullableGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", originBranchRef],
      });

      if (originHead !== null) {
        throw new Error(`${name} moved. Refresh and try again.`);
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
      args: ["fetch", "origin", "--prune", "--no-tags"],
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
      args: ["fetch", "origin", "--prune", "--no-tags"],
    });
    fetchedRepoRoots.push(repoRoot);
  }

  for (const {
    repoRoot,
    gitRefType,
    name,
    localSha,
    originSha,
  } of gitBranchSyncChanges) {
    if (localSha === ZERO_SHA || originSha === ZERO_SHA) {
      continue;
    }

    if (gitRefType === "tag") {
      await runGitCommandForPath({
        path: repoRoot,
        args: ["check-ref-format", `refs/tags/${name}`],
      });

      const tagRef = `refs/tags/${name}`;
      const remoteTagSha = await readRemoteTagSha({ repoRoot, tag: name });
      const currentLocalSha = await readNullableGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", tagRef],
      });

      if (currentLocalSha !== localSha || remoteTagSha !== originSha) {
        throw new Error(`${name} moved. Refresh and try again.`);
      }

      if (originSha === null) {
        if (localSha === null) {
          continue;
        }

        await ensureOldShaStaysVisibleAfterRefChange({
          repoRoot,
          oldSha: localSha,
          changedRef: tagRef,
          replacementSha: null,
          changedLocalBranch: null,
          rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
          shouldIncludeWorktreeHeads: true,
          message:
            "Deleting this tag would hide commits from the graph. Move or tag another branch first.",
        });

        await runGitCommandForPath({
          path: repoRoot,
          args: [
            "update-ref",
            "-m",
            `Crabtree: delete ${name}`,
            "-d",
            tagRef,
            localSha,
          ],
        });
        continue;
      }

      if (localSha !== null) {
        await ensureOldShaStaysVisibleAfterRefChange({
          repoRoot,
          oldSha: localSha,
          changedRef: tagRef,
          replacementSha: originSha,
          changedLocalBranch: null,
          rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
          shouldIncludeWorktreeHeads: true,
          message:
            "Resetting this tag would hide commits from the graph. Move or tag another branch first.",
        });
      }

      await runGitCommandForPath({
        path: repoRoot,
        args: ["fetch", "origin", `+refs/tags/${name}:refs/tags/${name}`],
      });
      continue;
    }

    await runGitCommandForPath({
      path: repoRoot,
      args: ["check-ref-format", "--branch", name],
    });

    const branchRef = `refs/heads/${name}`;
    const currentLocalSha = await readNullableGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", branchRef],
    });

    if (currentLocalSha !== localSha) {
      throw new Error(`${name} moved. Refresh and try again.`);
    }

    if (originSha === null) {
      if (localSha === null) {
        continue;
      }

      const originHead = await readNullableGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `refs/remotes/origin/${name}`],
      });

      if (originHead !== null) {
        throw new Error(`${name} moved. Refresh and try again.`);
      }

      await ensureOldShaStaysVisibleAfterRefChange({
        repoRoot,
        oldSha: localSha,
        changedRef: branchRef,
        replacementSha: null,
        changedLocalBranch: name,
        rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
        shouldIncludeWorktreeHeads: true,
        message:
          "Deleting this branch would hide commits from the graph. Move or tag another branch first.",
      });

      await deleteGitBranch({ repoRoot, branch: name, oldSha: localSha });
      continue;
    }

    const remoteSha = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", `${originSha}^{commit}`],
    });
    const remoteHead = await readGitTextForPath({
      path: repoRoot,
      args: ["rev-parse", "--verify", `refs/remotes/origin/${name}`],
    });

    if (remoteHead !== remoteSha) {
      throw new Error(`${name} moved. Refresh and try again.`);
    }

    if (localSha === null) {
      await runGitCommandForPath({
        path: repoRoot,
        args: [
          "update-ref",
          "-m",
          `Crabtree: create ${name}`,
          branchRef,
          remoteSha,
          ZERO_SHA,
        ],
      });
      continue;
    }

    await ensureOldShaStaysVisibleAfterRefChange({
      repoRoot,
      oldSha: localSha,
      changedRef: branchRef,
      replacementSha: remoteSha,
      changedLocalBranch: name,
      rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
      shouldIncludeWorktreeHeads: true,
      message:
        "Resetting this branch would hide commits from the graph. Move or tag another branch first.",
    });

    const worktreePath = await readGitWorktreePathForBranch({
      repoRoot,
      branch: name,
    });

    if (worktreePath === null) {
      await runGitCommandForPath({
        path: repoRoot,
        args: [
          "update-ref",
          "-m",
          `Crabtree: reset ${name}`,
          branchRef,
          remoteSha,
          localSha,
        ],
      });
      continue;
    }

    const statusText = await readGitTextForPath({
      path: worktreePath,
      args: ["status", "--porcelain"],
    });

    if (statusText.length > 0) {
      throw new Error(`Working tree must be clean before resetting ${name}.`);
    }

    const worktreeHead = await readGitTextForPath({
      path: worktreePath,
      args: ["rev-parse", "HEAD"],
    });

    if (worktreeHead !== localSha) {
      throw new Error(`${name} moved. Refresh and try again.`);
    }

    await runGitCommandForPath({
      path: worktreePath,
      args: ["reset", "--keep", remoteSha],
    });
  }
};
