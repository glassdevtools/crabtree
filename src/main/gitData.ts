import type {
  CodexThread,
  GitCommit,
  GitWorktree,
  RepoGraph,
} from "../shared/types";
import type { AppServerClient } from "./appServerClient";
import { execAppServerCommand } from "./appServerClient";

// Git is the source of truth for graph structure. Codex only tells us which thread belongs near a branch, commit, or worktree.
// TODO: AI-PICKED-VALUE: Reading commits in pages of 1000 keeps app-server responses bounded while still walking to the root.
const COMMIT_PAGE_SIZE = 1000;
const FIELD_SEPARATOR = "\u001f";

type RepoSeed = {
  key: string;
  root: string;
  originUrl: string | null;
  currentBranch: string | null;
  threadIds: string[];
};

const runGit = async ({
  appServerClient,
  cwd,
  args,
}: {
  appServerClient: AppServerClient;
  cwd: string;
  args: string[];
}) => {
  return await execAppServerCommand({
    appServerClient,
    cwd,
    command: ["git", ...args],
    timeoutMs: 10000,
  });
};

const readGitText = async ({
  appServerClient,
  cwd,
  args,
}: {
  appServerClient: AppServerClient;
  cwd: string;
  args: string[];
}) => {
  const { stdout } = await runGit({ appServerClient, cwd, args });

  return stdout.trim();
};

const readNullableGitText = async ({
  appServerClient,
  cwd,
  args,
}: {
  appServerClient: AppServerClient;
  cwd: string;
  args: string[];
}) => {
  try {
    const value = await readGitText({ appServerClient, cwd, args });

    if (value.length === 0) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
};

const readRepoSeedForThread = async ({
  appServerClient,
  thread,
}: {
  appServerClient: AppServerClient;
  thread: CodexThread;
}) => {
  if (thread.cwd.length === 0) {
    return null;
  }

  const root = await readNullableGitText({
    appServerClient,
    cwd: thread.cwd,
    args: ["rev-parse", "--show-toplevel"],
  });

  if (root === null) {
    return null;
  }

  const originUrl = await readNullableGitText({
    appServerClient,
    cwd: root,
    args: ["config", "--get", "remote.origin.url"],
  });
  const currentBranch = await readNullableGitText({
    appServerClient,
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

const readRepoSeeds = async ({
  appServerClient,
  threads,
}: {
  appServerClient: AppServerClient;
  threads: CodexThread[];
}) => {
  const repoSeedOfKey: { [key: string]: RepoSeed } = {};
  const repoSeedOfCwd: { [cwd: string]: RepoSeed | null } = {};

  for (const thread of threads) {
    let repoSeed = repoSeedOfCwd[thread.cwd];

    if (repoSeed === undefined) {
      repoSeed = await readRepoSeedForThread({ appServerClient, thread });
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
  appServerClient,
  repoSeed,
  threads,
}: {
  appServerClient: AppServerClient;
  repoSeed: RepoSeed;
  threads: CodexThread[];
}) => {
  const { stdout } = await runGit({
    appServerClient,
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

const readCommits = async ({
  appServerClient,
  repoSeed,
  threads,
}: {
  appServerClient: AppServerClient;
  repoSeed: RepoSeed;
  threads: CodexThread[];
}) => {
  const format = `%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ad${FIELD_SEPARATOR}%s`;
  const threadIdsOfSha: { [sha: string]: string[] } = {};
  const commits: GitCommit[] = [];

  for (const thread of threads) {
    const sha = thread.gitInfo?.sha;

    if (sha === undefined || sha === null) {
      continue;
    }

    if (threadIdsOfSha[sha] === undefined) {
      threadIdsOfSha[sha] = [];
    }

    threadIdsOfSha[sha].push(thread.id);
  }

  for (let skip = 0; ; skip += COMMIT_PAGE_SIZE) {
    const { stdout: shaStdout } = await runGit({
      appServerClient,
      cwd: repoSeed.root,
      args: [
        "rev-list",
        "--all",
        "--topo-order",
        `--max-count=${COMMIT_PAGE_SIZE}`,
        `--skip=${skip}`,
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
      appServerClient,
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
  appServerClient,
  threads,
}: {
  appServerClient: AppServerClient;
  threads: CodexThread[];
}) => {
  const repoSeeds = await readRepoSeeds({ appServerClient, threads });
  const repos: RepoGraph[] = [];
  const warnings: string[] = [];

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
      const [worktrees, commits, isShallowRepositoryText] = await Promise.all([
        readWorktrees({ appServerClient, repoSeed, threads: threadsInRepo }),
        readCommits({ appServerClient, repoSeed, threads: threadsInRepo }),
        readNullableGitText({
          appServerClient,
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
      warnings.push(`${repoSeed.root}: ${message}`);
    }
  }

  return { repos, warnings };
};
