import { stat } from "node:fs/promises";
import { simpleGit } from "simple-git";
import type {
  GitBranchTagChange,
  CodexThread,
  GitChangeSummary,
  GitCommit,
  GitWorktree,
  RepoGraph,
} from "../shared/types";

// Git is the source of truth for graph structure. Codex only tells us which thread belongs near a branch, commit, or worktree.
// TODO: AI-PICKED-VALUE: Reading commits in pages of 1000 keeps Git responses bounded while still walking to the root.
const COMMIT_PAGE_SIZE = 1000;
const FIELD_SEPARATOR = "\u001f";

type RepoSeed = {
  key: string;
  root: string;
  originUrl: string | null;
  currentBranch: string | null;
  threadIds: string[];
};

const runGit = async ({ cwd, args }: { cwd: string; args: string[] }) => {
  const stdout = await simpleGit({ baseDir: cwd }).raw(args);

  return { stdout };
};

const readGitText = async ({ cwd, args }: { cwd: string; args: string[] }) => {
  const { stdout } = await runGit({ cwd, args });

  return stdout.trim();
};

const readNullableGitText = async ({
  cwd,
  args,
}: {
  cwd: string;
  args: string[];
}) => {
  try {
    const value = await readGitText({ cwd, args });

    if (value.length === 0) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
};

const readIsDirectory = async (path: string) => {
  try {
    const pathStat = await stat(path);

    return pathStat.isDirectory();
  } catch {
    return false;
  }
};

const readIsGitWorkingTree = async ({ cwd }: { cwd: string }) => {
  if (!(await readIsDirectory(cwd))) {
    return false;
  }

  const isInsideWorkTree = await readNullableGitText({
    cwd,
    args: ["rev-parse", "--is-inside-work-tree"],
  });

  return isInsideWorkTree === "true";
};

const readRepoSeedForThread = async ({ thread }: { thread: CodexThread }) => {
  if (thread.cwd.length === 0) {
    return null;
  }

  const root = await readNullableGitText({
    cwd: thread.cwd,
    args: ["rev-parse", "--show-toplevel"],
  });

  if (root === null) {
    return null;
  }

  const originUrl = await readNullableGitText({
    cwd: root,
    args: ["config", "--get", "remote.origin.url"],
  });
  const currentBranch = await readNullableGitText({
    cwd: root,
    args: ["branch", "--show-current"],
  });

  const repoSeed: RepoSeed = {
    key: originUrl ?? root,
    root,
    originUrl,
    currentBranch,
    threadIds: [thread.id],
  };

  return repoSeed;
};

const readRepoSeeds = async ({ threads }: { threads: CodexThread[] }) => {
  const repoSeedOfKey: { [key: string]: RepoSeed } = {};
  const repoSeedOfCwd: { [cwd: string]: RepoSeed | null } = {};

  for (const thread of threads) {
    let repoSeed = repoSeedOfCwd[thread.cwd];

    if (repoSeed === undefined) {
      repoSeed = await readRepoSeedForThread({ thread });
      repoSeedOfCwd[thread.cwd] = repoSeed;
    }

    if (repoSeed === null) {
      continue;
    }

    const existingRepoSeed = repoSeedOfKey[repoSeed.key];

    if (existingRepoSeed === undefined) {
      repoSeedOfKey[repoSeed.key] = repoSeed;
      continue;
    }

    existingRepoSeed.threadIds.push(thread.id);
  }

  return Object.values(repoSeedOfKey);
};

const parseBranchReference = (value: string) => {
  const prefix = "refs/heads/";

  if (value.startsWith(prefix)) {
    return value.slice(prefix.length);
  }

  return value;
};

const readWorktrees = async ({
  repoSeed,
  threads,
}: {
  repoSeed: RepoSeed;
  threads: CodexThread[];
}) => {
  const { stdout } = await runGit({
    cwd: repoSeed.root,
    args: ["worktree", "list", "--porcelain"],
  });
  const worktrees: GitWorktree[] = [];
  let path: string | null = null;
  let head: string | null = null;
  let branch: string | null = null;
  let isDetached = false;

  const pushWorktree = () => {
    if (path === null) {
      return;
    }

    if (path === repoSeed.root) {
      return;
    }

    const threadIds = threads
      .filter(
        (thread) => thread.cwd === path || thread.cwd.startsWith(`${path}/`),
      )
      .map((thread) => thread.id);
    worktrees.push({ path, head, branch, isDetached, threadIds });
  };

  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      pushWorktree();
      path = null;
      head = null;
      branch = null;
      isDetached = false;
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");

    if (key === "worktree") {
      path = value;
      continue;
    }

    if (key === "HEAD") {
      head = value;
      continue;
    }

    if (key === "branch") {
      branch = parseBranchReference(value);
      continue;
    }

    if (key === "detached") {
      isDetached = true;
    }
  }

  pushWorktree();

  return worktrees;
};

const splitRefs = (value: string) => {
  if (value.length === 0) {
    return [];
  }

  return value.split(",").map((ref) => ref.trim());
};

const splitLines = (value: string) => {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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

const readGitChangeSummary = async ({ cwd }: { cwd: string }) => {
  const [unstaged, staged] = await Promise.all([
    runGit({ cwd, args: ["diff", "--numstat", "--", "."] }),
    runGit({ cwd, args: ["diff", "--cached", "--numstat", "--", "."] }),
  ]);
  const changeSummary: GitChangeSummary = {
    staged: parseGitChangeLineCounts(staged.stdout.trim()),
    unstaged: parseGitChangeLineCounts(unstaged.stdout.trim()),
  };

  return changeSummary;
};

const readGitBranchTagChanges = async ({
  repoSeed,
}: {
  repoSeed: RepoSeed;
}) => {
  if (repoSeed.originUrl === null) {
    return [];
  }

  const localBranchText = await readGitText({
    cwd: repoSeed.root,
    args: [
      "for-each-ref",
      `--format=%(refname:short)${FIELD_SEPARATOR}%(objectname)`,
      "refs/heads",
    ],
  });
  const originBranchText = await readNullableGitText({
    cwd: repoSeed.root,
    args: [
      "for-each-ref",
      `--format=%(refname:short)${FIELD_SEPARATOR}%(objectname)`,
      "refs/remotes/origin",
    ],
  });
  const remoteShaOfBranch: { [branch: string]: string } = {};
  const branchTagChanges: GitBranchTagChange[] = [];
  const originPrefix = "origin/";

  if (originBranchText === null) {
    return branchTagChanges;
  }

  for (const line of originBranchText.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [remoteBranch, remoteSha] = line.split(FIELD_SEPARATOR);

    if (
      remoteBranch === undefined ||
      remoteSha === undefined ||
      remoteBranch === "origin/HEAD" ||
      !remoteBranch.startsWith(originPrefix)
    ) {
      continue;
    }

    remoteShaOfBranch[remoteBranch.slice(originPrefix.length)] = remoteSha;
  }

  for (const line of localBranchText.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [branch, localSha] = line.split(FIELD_SEPARATOR);

    if (branch === undefined || localSha === undefined) {
      continue;
    }

    const remoteSha = remoteShaOfBranch[branch];

    if (remoteSha === undefined || remoteSha === localSha) {
      continue;
    }

    branchTagChanges.push({
      repoRoot: repoSeed.root,
      branch,
      oldSha: remoteSha,
      newSha: localSha,
    });
  }

  return branchTagChanges;
};

export const readGitChangesOfCwd = async ({
  threads,
  repos,
}: {
  threads: CodexThread[];
  repos: RepoGraph[];
}) => {
  const gitChangesOfCwd: { [cwd: string]: GitChangeSummary } = {};
  const gitErrors: string[] = [];
  const isCwdRead: { [cwd: string]: boolean } = {};
  const cwds = threads
    .map((thread) => thread.cwd)
    .filter((cwd) => cwd.length > 0);

  for (const repo of repos) {
    for (const worktree of repo.worktrees) {
      cwds.push(worktree.path);
    }
  }

  for (const cwd of cwds) {
    if (isCwdRead[cwd] === true) {
      continue;
    }

    isCwdRead[cwd] = true;

    if (!(await readIsGitWorkingTree({ cwd }))) {
      continue;
    }

    try {
      gitChangesOfCwd[cwd] = await readGitChangeSummary({ cwd });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Git error.";
      gitErrors.push(`${cwd}: ${message}`);
    }
  }

  return { gitChangesOfCwd, gitErrors };
};

const readCommits = async ({
  repoSeed,
  threads,
  worktrees,
}: {
  repoSeed: RepoSeed;
  threads: CodexThread[];
  worktrees: GitWorktree[];
}) => {
  const format = `%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ad${FIELD_SEPARATOR}%s`;
  const threadIdsOfSha: { [sha: string]: string[] } = {};
  const localBranchesOfSha: { [sha: string]: string[] } = {};
  const commits: GitCommit[] = [];
  const refText = await readGitText({
    cwd: repoSeed.root,
    args: [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ],
  });
  const localBranchText = await readGitText({
    cwd: repoSeed.root,
    args: [
      "for-each-ref",
      `--format=%(objectname)${FIELD_SEPARATOR}%(refname:short)`,
      "refs/heads",
    ],
  });
  const rootHead = await readNullableGitText({
    cwd: repoSeed.root,
    args: ["rev-parse", "HEAD"],
  });
  const worktreeHeads = worktrees
    .map((worktree) => worktree.head)
    .filter((head): head is string => head !== null);
  const historyRoots = [
    ...splitLines(refText),
    ...(rootHead === null ? [] : [rootHead]),
    ...worktreeHeads,
  ];
  const shaOfCwd: { [cwd: string]: string | null } = {};

  if (historyRoots.length === 0) {
    return commits;
  }

  for (const thread of threads) {
    let cwdSha = shaOfCwd[thread.cwd];

    if (cwdSha === undefined) {
      cwdSha =
        thread.cwd.length === 0
          ? null
          : await readNullableGitText({
              cwd: thread.cwd,
              args: ["rev-parse", "HEAD"],
            });
      shaOfCwd[thread.cwd] = cwdSha;
    }

    const sha = cwdSha ?? thread.gitInfo?.sha;

    if (sha === undefined || sha === null) {
      continue;
    }

    if (threadIdsOfSha[sha] === undefined) {
      threadIdsOfSha[sha] = [];
    }

    threadIdsOfSha[sha].push(thread.id);
  }

  for (const line of localBranchText.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [sha, branch] = line.split(FIELD_SEPARATOR);

    if (sha === undefined || branch === undefined) {
      continue;
    }

    if (localBranchesOfSha[sha] === undefined) {
      localBranchesOfSha[sha] = [];
    }

    localBranchesOfSha[sha].push(branch);
  }

  for (let skip = 0; ; skip += COMMIT_PAGE_SIZE) {
    const { stdout: shaStdout } = await runGit({
      cwd: repoSeed.root,
      args: [
        "rev-list",
        "--topo-order",
        `--max-count=${COMMIT_PAGE_SIZE}`,
        `--skip=${skip}`,
        ...historyRoots,
      ],
    });
    const shas = shaStdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (shas.length === 0) {
      break;
    }

    const { stdout } = await runGit({
      cwd: repoSeed.root,
      args: [
        "log",
        "--no-walk=unsorted",
        "--date=iso-strict",
        `--pretty=format:${format}`,
        ...shas,
      ],
    });

    const commitOfSha: { [sha: string]: GitCommit } = {};

    for (const line of stdout.split("\n")) {
      if (line.length === 0) {
        continue;
      }

      const [sha, parentsText, refsText, author, date, subject] =
        line.split(FIELD_SEPARATOR);

      if (
        sha === undefined ||
        parentsText === undefined ||
        refsText === undefined ||
        author === undefined ||
        date === undefined ||
        subject === undefined
      ) {
        continue;
      }

      commitOfSha[sha] = {
        sha,
        shortSha: sha.slice(0, 7),
        parents: parentsText.length === 0 ? [] : parentsText.split(" "),
        refs: splitRefs(refsText),
        localBranches: localBranchesOfSha[sha] ?? [],
        author,
        date,
        subject,
        threadIds: threadIdsOfSha[sha] ?? [],
      };
    }

    for (const sha of shas) {
      const commit = commitOfSha[sha];

      if (commit === undefined) {
        continue;
      }

      commits.push(commit);
    }

    if (shas.length < COMMIT_PAGE_SIZE) {
      break;
    }
  }

  return commits;
};

export const readRepoGraphs = async ({
  threads,
}: {
  threads: CodexThread[];
}) => {
  const repoSeeds = await readRepoSeeds({ threads });
  const repos: RepoGraph[] = [];
  const warnings: string[] = [];
  const gitErrors: string[] = [];

  const readMissingParentCount = (commits: GitCommit[]) => {
    const isCommitOfSha: { [sha: string]: boolean } = {};
    let missingParentCount = 0;

    for (const commit of commits) {
      isCommitOfSha[commit.sha] = true;
    }

    for (const commit of commits) {
      for (const parent of commit.parents) {
        if (isCommitOfSha[parent] === true) {
          continue;
        }

        missingParentCount += 1;
      }
    }

    return missingParentCount;
  };

  for (const repoSeed of repoSeeds) {
    const threadsInRepo = threads.filter((thread) =>
      repoSeed.threadIds.includes(thread.id),
    );

    try {
      const worktrees = await readWorktrees({
        repoSeed,
        threads: threadsInRepo,
      });
      const [commits, branchTagChanges, isShallowRepositoryText] =
        await Promise.all([
          readCommits({ repoSeed, threads: threadsInRepo, worktrees }),
          readGitBranchTagChanges({ repoSeed }),
          readNullableGitText({
            cwd: repoSeed.root,
            args: ["rev-parse", "--is-shallow-repository"],
          }),
        ]);
      const missingParentCount = readMissingParentCount(commits);

      repos.push({
        key: repoSeed.key,
        root: repoSeed.root,
        originUrl: repoSeed.originUrl,
        currentBranch: repoSeed.currentBranch,
        branchTagChanges,
        worktrees,
        commits,
        threadIds: repoSeed.threadIds,
      });

      if (isShallowRepositoryText === "true") {
        warnings.push(
          `${repoSeed.root}: Git repository is shallow, so history can only show commits available locally.`,
        );
      }

      if (missingParentCount > 0) {
        warnings.push(
          `${repoSeed.root}: ${missingParentCount} parent commits are missing from local Git history.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Git error.";
      gitErrors.push(`${repoSeed.root}: ${message}`);
    }
  }

  return { repos, warnings, gitErrors };
};
