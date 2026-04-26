import type {
  CodexThread,
  GitCommit,
  GitWorktree,
  RepoGraph,
} from "../shared/types";
import type { AppServerClient } from "./appServerClient";
import { execAppServerCommand } from "./appServerClient";

// Git is the source of truth for graph structure. Codex only tells us which thread belongs near a branch, commit, or worktree.
// TODO: AI-PICKED-VALUE: Showing 80 recent commits keeps the first graph readable while we build the real navigation controls.
const COMMIT_LIMIT = 80;
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
  const { stdout } = await runGit({
    appServerClient,
    cwd: repoSeed.root,
    args: [
      "log",
      "--all",
      "--topo-order",
      `--max-count=${COMMIT_LIMIT}`,
      "--date=iso-strict",
      `--pretty=format:${format}`,
    ],
  });
  const commits: GitCommit[] = [];

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

    const threadIds = threads
      .filter((thread) => {
        if (thread.gitInfo === null) {
          return false;
        }

        return thread.gitInfo.sha === sha;
      })
      .map((thread) => thread.id);

    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      parents: parentsText.length === 0 ? [] : parentsText.split(" "),
      refs: splitRefs(refsText),
      author,
      date,
      subject,
      threadIds,
    });
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

  for (const repoSeed of repoSeeds) {
    const threadsInRepo = threads.filter((thread) =>
      repoSeed.threadIds.includes(thread.id),
    );

    try {
      const [worktrees, commits] = await Promise.all([
        readWorktrees({ appServerClient, repoSeed, threads: threadsInRepo }),
        readCommits({ appServerClient, repoSeed, threads: threadsInRepo }),
      ]);

      repos.push({
        key: repoSeed.key,
        root: repoSeed.root,
        originUrl: repoSeed.originUrl,
        currentBranch: repoSeed.currentBranch,
        worktrees,
        commits,
        threadIds: repoSeed.threadIds,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Git error.";
      warnings.push(`${repoSeed.root}: ${message}`);
    }
  }

  return { repos, warnings };
};
