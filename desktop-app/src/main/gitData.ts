import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type {
  GitBranchSyncChange,
  CodexThread,
  GitChangeSummary,
  GitCommit,
  GitWorktree,
  RepoGraph,
} from "../shared/types";

// Git is the source of truth for graph structure. Codex only tells us which thread belongs near a branch, commit, or worktree.
const COMMIT_READ_LIMIT = 2000;
// TODO: AI-PICKED-VALUE: Fetching origin every 30 seconds keeps remote branch state current without turning one-second dashboard refreshes into network polling.
const ORIGIN_FETCH_INTERVAL_MS = 30_000;
// TODO: AI-PICKED-VALUE: Six parallel Git reads keeps dashboard refreshes responsive without launching a large process burst.
const GIT_READ_PARALLEL_LIMIT = 6;
// TODO: AI-PICKED-VALUE: This stops one blocked Git process from holding the whole dashboard load forever.
const GIT_COMMAND_TIMEOUT_MS = 20_000;
const MAX_UNTRACKED_ADDED_LINE_COUNT = 10_000;
// TODO: AI-PICKED-VALUE: Reading files in 64 KiB chunks keeps untracked line counts bounded without loading large files into memory.
const UNTRACKED_FILE_READ_CHUNK_BYTE_COUNT = 64 * 1024;
const FIELD_SEPARATOR = "\u001f";
const ZERO_SHA = "0000000000000000000000000000000000000000";
const lastOriginFetchAttemptTimeOfRepoRoot: { [repoRoot: string]: number } = {};
const defaultBranchCacheOfRepoRoot: {
  [repoRoot: string]: { branch: string | null; readTime: number };
} = {};

type RepoSeed = {
  key: string;
  root: string;
  originUrl: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  threadIds: string[];
};

type RepoGraphReadResult = {
  repo: RepoGraph | null;
  warnings: string[];
  gitErrors: string[];
};

type RepoSeedReadResult = {
  repoSeed: RepoSeed | null;
  gitError: string | null;
};

type RepoSeedReadSummary = {
  repoSeeds: RepoSeed[];
  gitErrors: string[];
};

const readValuesWithGitReadLimit = async <Item, Result>({
  items,
  readItem,
}: {
  items: Item[];
  readItem: (item: Item) => Promise<Result>;
}) => {
  const results: Result[] = [];
  let nextItemIndex = 0;

  const readNextItem = async () => {
    for (;;) {
      const itemIndex = nextItemIndex;
      nextItemIndex += 1;
      const item = items[itemIndex];

      if (item === undefined) {
        return;
      }

      results[itemIndex] = await readItem(item);
    }
  };

  const workerCount = Math.min(GIT_READ_PARALLEL_LIMIT, items.length);
  const workers: Promise<void>[] = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push(readNextItem());
  }

  await Promise.all(workers);

  return results;
};

const runGit = async ({ cwd, args }: { cwd: string; args: string[] }) => {
  const stdout = await simpleGit({
    baseDir: cwd,
    timeout: { block: GIT_COMMAND_TIMEOUT_MS },
  })
    .env("GIT_TERMINAL_PROMPT", "0")
    .raw(args);

  return { stdout };
};

const readGitText = async ({ cwd, args }: { cwd: string; args: string[] }) => {
  const { stdout } = await runGit({ cwd, args });

  return stdout.trim();
};

const readErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown Git error.";
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

const readLocalDefaultBranch = async ({ root }: { root: string }) => {
  const originHead = await readNullableGitText({
    cwd: root,
    args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
  });

  if (originHead !== null) {
    return readDefaultBranchNameFromOriginHeadText(originHead);
  }

  return null;
};

const readDefaultBranch = async ({ root }: { root: string }) => {
  const localDefaultBranch = await readLocalDefaultBranch({ root });

  if (localDefaultBranch !== null) {
    return localDefaultBranch;
  }

  const cachedDefaultBranch = defaultBranchCacheOfRepoRoot[root];
  const now = Date.now();

  if (
    cachedDefaultBranch !== undefined &&
    now - cachedDefaultBranch.readTime < ORIGIN_FETCH_INTERVAL_MS
  ) {
    return cachedDefaultBranch.branch;
  }

  const remoteOriginHead = await readNullableGitText({
    cwd: root,
    args: ["ls-remote", "--symref", "origin", "HEAD"],
  });
  const defaultBranch =
    remoteOriginHead === null
      ? null
      : readDefaultBranchNameFromOriginHeadText(remoteOriginHead);

  defaultBranchCacheOfRepoRoot[root] = { branch: defaultBranch, readTime: now };

  return defaultBranch;
};

const readMainWorktreePath = async ({ root }: { root: string }) => {
  const { stdout } = await runGit({
    cwd: root,
    args: ["worktree", "list", "--porcelain"],
  });
  const prefix = "worktree ";

  for (const line of stdout.split("\n")) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length);
    }
  }

  throw new Error("Git worktree list did not include a main worktree.");
};

const readCurrentBranchAfterAttachingDetachedHead = async ({
  root,
}: {
  root: string;
}) => {
  const currentBranch = await readNullableGitText({
    cwd: root,
    args: ["branch", "--show-current"],
  });

  if (currentBranch !== null) {
    return currentBranch;
  }

  const headSha = await readNullableGitText({
    cwd: root,
    args: ["rev-parse", "HEAD"],
  });

  if (headSha === null) {
    return null;
  }

  const branchText = await readGitText({
    cwd: root,
    args: [
      "for-each-ref",
      "--sort=refname",
      "--points-at",
      headSha,
      "--format=%(refname:short)",
      "refs/heads",
    ],
  });
  const branch = splitLines(branchText)[0] ?? null;

  if (branch === null) {
    return null;
  }

  await runGit({
    cwd: root,
    args: ["switch", "--ignore-other-worktrees", branch],
  });

  return branch;
};

const readRepoSeedForThread = async ({ thread }: { thread: CodexThread }) => {
  if (thread.cwd.length === 0) {
    const repoSeedReadResult: RepoSeedReadResult = {
      repoSeed: null,
      gitError: null,
    };

    return repoSeedReadResult;
  }

  try {
    const threadRoot = await readGitText({
      cwd: thread.cwd,
      args: ["rev-parse", "--show-toplevel"],
    });
    const root = await readMainWorktreePath({ root: threadRoot });
    const originUrl = await readNullableGitText({
      cwd: root,
      args: ["config", "--get", "remote.origin.url"],
    });
    const currentBranch = await readCurrentBranchAfterAttachingDetachedHead({
      root,
    });
    const defaultBranch = await readLocalDefaultBranch({ root });

    const repoSeed: RepoSeed = {
      key: originUrl ?? root,
      root,
      originUrl,
      currentBranch,
      defaultBranch,
      threadIds: [thread.id],
    };

    return {
      repoSeed,
      gitError: null,
    };
  } catch (error) {
    return {
      repoSeed: null,
      gitError: `${thread.cwd}: Failed to read Git repository from Codex thread folder. ${readErrorMessage(error)}`,
    };
  }
};

const readRepoSeeds = async ({ threads }: { threads: CodexThread[] }) => {
  const repoSeedOfKey: { [key: string]: RepoSeed } = {};
  const threadsOfCwd: { [cwd: string]: CodexThread[] } = {};
  const gitErrors: string[] = [];
  const cwds: string[] = [];

  for (const thread of threads) {
    let threadsForCwd = threadsOfCwd[thread.cwd];

    if (threadsForCwd === undefined) {
      threadsForCwd = [];
      threadsOfCwd[thread.cwd] = threadsForCwd;
      cwds.push(thread.cwd);
    }

    threadsForCwd.push(thread);
  }

  const repoSeedReadResults = await readValuesWithGitReadLimit({
    items: cwds,
    readItem: async (cwd) => {
      const threadsForCwd = threadsOfCwd[cwd];
      const thread = threadsForCwd?.[0];

      if (thread === undefined) {
        return { cwd, repoSeed: null, gitError: null };
      }

      return {
        cwd,
        ...(await readRepoSeedForThread({ thread })),
      };
    },
  });

  for (const repoSeedReadResult of repoSeedReadResults) {
    const repoSeed = repoSeedReadResult.repoSeed;
    const threadsForCwd = threadsOfCwd[repoSeedReadResult.cwd];

    if (repoSeedReadResult.gitError !== null) {
      gitErrors.push(repoSeedReadResult.gitError);
    }

    if (repoSeed === null || threadsForCwd === undefined) {
      continue;
    }

    const existingRepoSeed = repoSeedOfKey[repoSeed.key];
    const threadIds = threadsForCwd.map((thread) => thread.id);

    if (existingRepoSeed === undefined) {
      repoSeed.threadIds = threadIds;
      repoSeedOfKey[repoSeed.key] = repoSeed;
      continue;
    }

    existingRepoSeed.threadIds.push(...threadIds);
  }

  const repoSeedReadSummary: RepoSeedReadSummary = {
    repoSeeds: Object.values(repoSeedOfKey),
    gitErrors,
  };

  return repoSeedReadSummary;
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
  let mainWorktreePath: string | null = null;
  let path: string | null = null;
  let head: string | null = null;
  let branch: string | null = null;
  let isDetached = false;
  let didReadMainWorktree = false;

  const pushWorktree = () => {
    if (path === null) {
      return;
    }

    if (!didReadMainWorktree) {
      didReadMainWorktree = true;
      mainWorktreePath = path;
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
      head = value === ZERO_SHA ? null : value;
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

  if (mainWorktreePath === null) {
    throw new Error("Git worktree list did not include a main worktree.");
  }

  return { mainWorktreePath, worktrees };
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

const readRemoteTagName = (remoteRef: string) => {
  const tagPrefix = "refs/tags/";

  if (!remoteRef.startsWith(tagPrefix) || remoteRef.endsWith("^{}")) {
    return null;
  }

  return remoteRef.slice(tagPrefix.length);
};

const parseGitChangeCounts = (stdout: string) => {
  const changeCounts = {
    added: 0,
    removed: 0,
    changedFileCount: 0,
  };

  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [addedText, removedText] = line.split("\t");
    const added = Number(addedText);
    const removed = Number(removedText);

    // Binary numstat rows use "-" for line counts, but each row is still one changed file.
    changeCounts.changedFileCount += 1;

    if (Number.isFinite(added)) {
      changeCounts.added += added;
    }

    if (Number.isFinite(removed)) {
      changeCounts.removed += removed;
    }
  }

  return changeCounts;
};

const parseGitStatusSummary = (stdout: string) => {
  const untrackedPaths: string[] = [];
  let conflictCount = 0;

  for (const entry of stdout.split("\0")) {
    const statusCode = entry.slice(0, 2);

    switch (statusCode) {
      case "??": {
        const path = entry.slice(3);

        if (path.length !== 0) {
          untrackedPaths.push(path);
        }

        break;
      }
      case "DD":
      case "AU":
      case "UD":
      case "UA":
      case "DU":
      case "AA":
      case "UU":
        conflictCount += 1;
        break;
    }
  }

  return { conflictCount, untrackedPaths };
};

const readFileAddedLineCount = async ({
  path,
  maxAddedLineCount,
}: {
  path: string;
  maxAddedLineCount: number;
}) => {
  const fileHandle = await open(path, "r");
  const buffer = Buffer.alloc(UNTRACKED_FILE_READ_CHUNK_BYTE_COUNT);
  let addedLineCount = 0;
  let didReadAnyBytes = false;
  let lastByte = 0;

  try {
    for (;;) {
      const { bytesRead } = await fileHandle.read({
        buffer,
        offset: 0,
        length: buffer.length,
        position: null,
      });

      if (bytesRead === 0) {
        break;
      }

      didReadAnyBytes = true;

      for (let byteIndex = 0; byteIndex < bytesRead; byteIndex += 1) {
        const byte = buffer[byteIndex];

        if (byte === undefined) {
          continue;
        }

        if (byte === 0) {
          return 0;
        }

        lastByte = byte;

        if (byte !== 10) {
          continue;
        }

        addedLineCount += 1;

        if (addedLineCount >= maxAddedLineCount) {
          return maxAddedLineCount;
        }
      }
    }

    if (didReadAnyBytes && lastByte !== 10) {
      addedLineCount += 1;
    }

    return Math.min(addedLineCount, maxAddedLineCount);
  } finally {
    await fileHandle.close();
  }
};

const readGitStatusChangeSummary = async ({ cwd }: { cwd: string }) => {
  const [repoRoot, status] = await Promise.all([
    readGitText({ cwd, args: ["rev-parse", "--show-toplevel"] }),
    runGit({
      cwd,
      args: ["status", "--porcelain=v1", "-uall", "-z", "--", "."],
    }),
  ]);
  const gitStatusSummary = parseGitStatusSummary(status.stdout);
  let addedLineCount = 0;
  let changedFileCount = 0;

  for (const untrackedPath of gitStatusSummary.untrackedPaths) {
    if (addedLineCount >= MAX_UNTRACKED_ADDED_LINE_COUNT) {
      break;
    }

    const path = join(repoRoot, untrackedPath);
    const pathStat = await stat(path);

    if (!pathStat.isFile()) {
      continue;
    }

    changedFileCount += 1;
    addedLineCount += await readFileAddedLineCount({
      path,
      maxAddedLineCount: MAX_UNTRACKED_ADDED_LINE_COUNT - addedLineCount,
    });
  }

  return {
    conflictCount: gitStatusSummary.conflictCount,
    untracked: {
      added: Math.min(addedLineCount, MAX_UNTRACKED_ADDED_LINE_COUNT),
      removed: 0,
      changedFileCount,
    },
  };
};

const readGitChangeSummary = async ({ cwd }: { cwd: string }) => {
  const [unstaged, staged, statusChangeSummary] = await Promise.all([
    runGit({ cwd, args: ["diff", "--numstat", "--", "."] }),
    runGit({ cwd, args: ["diff", "--cached", "--numstat", "--", "."] }),
    readGitStatusChangeSummary({ cwd }),
  ]);
  const unstagedCounts = parseGitChangeCounts(unstaged.stdout.trim());
  const { untracked } = statusChangeSummary;
  const changeSummary: GitChangeSummary = {
    conflictCount: statusChangeSummary.conflictCount,
    staged: parseGitChangeCounts(staged.stdout.trim()),
    unstaged: {
      added: unstagedCounts.added + untracked.added,
      removed: unstagedCounts.removed + untracked.removed,
      changedFileCount:
        unstagedCounts.changedFileCount + untracked.changedFileCount,
    },
  };

  return changeSummary;
};

const readGitBranchSyncChanges = async ({
  repoSeed,
}: {
  repoSeed: RepoSeed;
}) => {
  if (repoSeed.originUrl === null) {
    return [];
  }

  const [localBranchText, originBranchText, localTagText, originTagText] =
    await Promise.all([
      readGitText({
        cwd: repoSeed.root,
        args: [
          "for-each-ref",
          `--format=%(refname:short)${FIELD_SEPARATOR}%(objectname)`,
          "refs/heads",
        ],
      }),
      readNullableGitText({
        cwd: repoSeed.root,
        args: [
          "for-each-ref",
          `--format=%(refname:short)${FIELD_SEPARATOR}%(objectname)`,
          "refs/remotes/origin",
        ],
      }),
      readGitText({
        cwd: repoSeed.root,
        args: [
          "for-each-ref",
          `--format=%(refname:strip=2)${FIELD_SEPARATOR}%(objectname)`,
          "refs/tags",
        ],
      }),
      readNullableGitText({
        cwd: repoSeed.root,
        args: ["ls-remote", "--tags", "origin"],
      }),
    ]);
  const remoteShaOfBranch: { [branch: string]: string } = {};
  const localShaOfBranch: { [branch: string]: string } = {};
  const remoteShaOfTag: { [tag: string]: string } = {};
  const localShaOfTag: { [tag: string]: string } = {};
  const branchSyncChanges: GitBranchSyncChange[] = [];
  const originPrefix = "origin/";

  if (originBranchText !== null) {
    for (const line of originBranchText.split("\n")) {
      if (line.length === 0) {
        continue;
      }

      const [remoteBranch, remoteSha] = line.split(FIELD_SEPARATOR);

      if (
        remoteBranch === undefined ||
        remoteSha === undefined ||
        remoteSha === ZERO_SHA ||
        remoteBranch === "origin/HEAD" ||
        !remoteBranch.startsWith(originPrefix)
      ) {
        continue;
      }

      remoteShaOfBranch[remoteBranch.slice(originPrefix.length)] = remoteSha;
    }
  }

  for (const line of localBranchText.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [branch, localSha] = line.split(FIELD_SEPARATOR);

    if (
      branch === undefined ||
      localSha === undefined ||
      localSha === ZERO_SHA
    ) {
      continue;
    }

    const remoteSha = remoteShaOfBranch[branch];
    localShaOfBranch[branch] = localSha;

    if (remoteSha === localSha) {
      continue;
    }

    branchSyncChanges.push({
      repoRoot: repoSeed.root,
      gitRefType: "branch",
      name: branch,
      localSha,
      originSha: remoteSha ?? null,
    });
  }

  for (const branch of Object.keys(remoteShaOfBranch)) {
    if (localShaOfBranch[branch] !== undefined) {
      continue;
    }

    const remoteSha = remoteShaOfBranch[branch];

    if (remoteSha === undefined) {
      continue;
    }

    branchSyncChanges.push({
      repoRoot: repoSeed.root,
      gitRefType: "branch",
      name: branch,
      localSha: null,
      originSha: remoteSha,
    });
  }

  if (originTagText !== null) {
    for (const line of originTagText.split("\n")) {
      if (line.length === 0) {
        continue;
      }

      const [remoteSha, remoteRef] = line.split("\t");

      if (
        remoteSha === undefined ||
        remoteRef === undefined ||
        remoteSha === ZERO_SHA
      ) {
        continue;
      }

      const tag = readRemoteTagName(remoteRef);

      if (tag === null) {
        continue;
      }

      remoteShaOfTag[tag] = remoteSha;
    }
  }

  for (const line of localTagText.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [tag, localSha] = line.split(FIELD_SEPARATOR);

    if (tag === undefined || localSha === undefined || localSha === ZERO_SHA) {
      continue;
    }

    const remoteSha = remoteShaOfTag[tag];
    localShaOfTag[tag] = localSha;

    if (remoteSha === localSha) {
      continue;
    }

    branchSyncChanges.push({
      repoRoot: repoSeed.root,
      gitRefType: "tag",
      name: tag,
      localSha,
      originSha: remoteSha ?? null,
    });
  }

  for (const tag of Object.keys(remoteShaOfTag)) {
    if (localShaOfTag[tag] !== undefined) {
      continue;
    }

    const remoteSha = remoteShaOfTag[tag];

    if (remoteSha === undefined) {
      continue;
    }

    branchSyncChanges.push({
      repoRoot: repoSeed.root,
      gitRefType: "tag",
      name: tag,
      localSha: null,
      originSha: remoteSha,
    });
  }

  return branchSyncChanges;
};

const fetchMissingOriginTags = async ({ repoSeed }: { repoSeed: RepoSeed }) => {
  const [localTagText, originTagText] = await Promise.all([
    readGitText({
      cwd: repoSeed.root,
      args: ["for-each-ref", "--format=%(refname:strip=2)", "refs/tags"],
    }),
    readNullableGitText({
      cwd: repoSeed.root,
      args: ["ls-remote", "--tags", "origin"],
    }),
  ]);
  const isLocalTagOfName: { [tag: string]: boolean } = {};
  const isMissingTagOfName: { [tag: string]: boolean } = {};
  const missingTagRefspecs: string[] = [];

  for (const tag of splitLines(localTagText)) {
    isLocalTagOfName[tag] = true;
  }

  if (originTagText === null) {
    return;
  }

  for (const line of originTagText.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [remoteSha, remoteRef] = line.split("\t");

    if (
      remoteSha === undefined ||
      remoteRef === undefined ||
      remoteSha === ZERO_SHA
    ) {
      continue;
    }

    const tag = readRemoteTagName(remoteRef);

    if (
      tag === null ||
      isLocalTagOfName[tag] === true ||
      isMissingTagOfName[tag] === true
    ) {
      continue;
    }

    isMissingTagOfName[tag] = true;
    missingTagRefspecs.push(`refs/tags/${tag}:refs/tags/${tag}`);
  }

  if (missingTagRefspecs.length === 0) {
    return;
  }

  await runGit({
    cwd: repoSeed.root,
    args: ["fetch", "origin", "--no-tags", ...missingTagRefspecs],
  });
};

const fetchOriginRefs = async ({ repoSeed }: { repoSeed: RepoSeed }) => {
  if (repoSeed.originUrl === null) {
    return null;
  }

  const now = Date.now();
  const lastOriginFetchAttemptTime =
    lastOriginFetchAttemptTimeOfRepoRoot[repoSeed.root];

  if (
    lastOriginFetchAttemptTime !== undefined &&
    now - lastOriginFetchAttemptTime < ORIGIN_FETCH_INTERVAL_MS
  ) {
    return null;
  }

  lastOriginFetchAttemptTimeOfRepoRoot[repoSeed.root] = now;

  try {
    await runGit({
      cwd: repoSeed.root,
      args: ["fetch", "origin", "--prune", "--no-tags"],
    });
    await fetchMissingOriginTags({ repoSeed });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Git error.";

    return `${repoSeed.root}: Failed to fetch origin. Sync state may be stale. ${message}`;
  }

  return null;
};

const readGitChangeCwds = ({
  threads,
  repos,
}: {
  threads: CodexThread[];
  repos: RepoGraph[];
}) => {
  const isCwdRead: { [cwd: string]: boolean } = {};
  const cwds: string[] = [];

  const pushCwd = (cwd: string) => {
    if (cwd.length === 0 || isCwdRead[cwd] === true) {
      return;
    }

    isCwdRead[cwd] = true;
    cwds.push(cwd);
  };

  for (const thread of threads) {
    pushCwd(thread.cwd);
  }

  for (const repo of repos) {
    pushCwd(repo.root);

    for (const worktree of repo.worktrees) {
      pushCwd(worktree.path);
    }
  }

  return cwds;
};

const readGitChangeSummariesOfCwds = async ({ cwds }: { cwds: string[] }) => {
  const gitChangesOfCwd: { [cwd: string]: GitChangeSummary } = {};
  const gitErrors: string[] = [];
  const changeResults = await readValuesWithGitReadLimit({
    items: cwds,
    readItem: async (cwd) => {
      if (!(await readIsGitWorkingTree({ cwd }))) {
        return { cwd, changeSummary: null, gitError: null };
      }

      try {
        return {
          cwd,
          changeSummary: await readGitChangeSummary({ cwd }),
          gitError: null,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown Git error.";

        return {
          cwd,
          changeSummary: null,
          gitError: `${cwd}: ${message}`,
        };
      }
    },
  });

  for (const changeResult of changeResults) {
    if (changeResult.changeSummary !== null) {
      gitChangesOfCwd[changeResult.cwd] = changeResult.changeSummary;
    }

    if (changeResult.gitError === null) {
      continue;
    }

    gitErrors.push(changeResult.gitError);
  }

  return { gitChangesOfCwd, gitErrors };
};

export const readGitChangesOfCwd = async ({
  threads,
  repos,
}: {
  threads: CodexThread[];
  repos: RepoGraph[];
}) => {
  return await readGitChangeSummariesOfCwds({
    cwds: readGitChangeCwds({ threads, repos }),
  });
};

export const readGitChangesOfCwdForRepoRoots = async ({
  threads,
  repos,
  previousGitChangesOfCwd,
  repoRoots,
}: {
  threads: CodexThread[];
  repos: RepoGraph[];
  previousGitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  repoRoots: string[];
}) => {
  const shouldReadRepoOfRoot: { [repoRoot: string]: boolean } = {};
  const shouldReadThreadOfId: { [threadId: string]: boolean } = {};
  const changedRepos: RepoGraph[] = [];
  const changedThreads: CodexThread[] = [];

  for (const repoRoot of repoRoots) {
    shouldReadRepoOfRoot[repoRoot] = true;
  }

  for (const repo of repos) {
    if (shouldReadRepoOfRoot[repo.root] !== true) {
      continue;
    }

    changedRepos.push(repo);

    for (const threadId of repo.threadIds) {
      shouldReadThreadOfId[threadId] = true;
    }
  }

  for (const thread of threads) {
    if (shouldReadThreadOfId[thread.id] !== true) {
      continue;
    }

    changedThreads.push(thread);
  }

  const changedCwds = readGitChangeCwds({
    threads: changedThreads,
    repos: changedRepos,
  });
  const shouldReplaceCwd: { [cwd: string]: boolean } = {};

  for (const cwd of changedCwds) {
    shouldReplaceCwd[cwd] = true;
  }

  const changeResult = await readGitChangeSummariesOfCwds({
    cwds: changedCwds,
  });
  const gitChangesOfCwd: { [cwd: string]: GitChangeSummary } = {};

  for (const cwd of Object.keys(previousGitChangesOfCwd)) {
    const changeSummary = previousGitChangesOfCwd[cwd];

    if (changeSummary === undefined || shouldReplaceCwd[cwd] === true) {
      continue;
    }

    gitChangesOfCwd[cwd] = changeSummary;
  }

  for (const cwd of Object.keys(changeResult.gitChangesOfCwd)) {
    const changeSummary = changeResult.gitChangesOfCwd[cwd];

    if (changeSummary === undefined) {
      continue;
    }

    gitChangesOfCwd[cwd] = changeSummary;
  }

  return { gitChangesOfCwd, gitErrors: changeResult.gitErrors };
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
    .filter((head): head is string => head !== null && head !== ZERO_SHA);
  const historyRoots = [
    ...splitLines(refText),
    ...(rootHead === null ? [] : [rootHead]),
    ...worktreeHeads,
  ];
  const shaOfCwd: { [cwd: string]: string | null } = {};
  const threadCwds: string[] = [];
  const isThreadCwdQueued: { [cwd: string]: boolean } = {};

  if (historyRoots.length === 0) {
    return commits;
  }

  for (const thread of threads) {
    if (thread.cwd.length === 0 || isThreadCwdQueued[thread.cwd] === true) {
      continue;
    }

    isThreadCwdQueued[thread.cwd] = true;
    threadCwds.push(thread.cwd);
  }

  const cwdShaResults = await readValuesWithGitReadLimit({
    items: threadCwds,
    readItem: async (cwd) => {
      return {
        cwd,
        sha: await readNullableGitText({
          cwd,
          args: ["rev-parse", "HEAD"],
        }),
      };
    },
  });

  for (const cwdShaResult of cwdShaResults) {
    shaOfCwd[cwdShaResult.cwd] = cwdShaResult.sha;
  }

  for (const thread of threads) {
    const cwdSha = thread.cwd.length === 0 ? null : shaOfCwd[thread.cwd];
    const sha = cwdSha ?? thread.gitInfo?.sha;

    if (sha === undefined || sha === null || sha === ZERO_SHA) {
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

  const { stdout: shaStdout } = await runGit({
    cwd: repoSeed.root,
    args: [
      "rev-list",
      "--topo-order",
      `--max-count=${COMMIT_READ_LIMIT}`,
      ...historyRoots,
    ],
  });
  const shas = shaStdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (shas.length === 0) {
    return commits;
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

  return commits;
};

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

const readRepoSeedForExistingRepo = async ({ repo }: { repo: RepoGraph }) => {
  const [originUrl, currentBranch, defaultBranch] = await Promise.all([
    readNullableGitText({
      cwd: repo.root,
      args: ["config", "--get", "remote.origin.url"],
    }),
    readCurrentBranchAfterAttachingDetachedHead({
      root: repo.root,
    }),
    readDefaultBranch({ root: repo.root }),
  ]);
  const repoSeed: RepoSeed = {
    key: originUrl ?? repo.root,
    root: repo.root,
    originUrl,
    currentBranch,
    defaultBranch,
    threadIds: repo.threadIds,
  };

  return repoSeed;
};

const readRepoGraphForSeed = async ({
  repoSeed,
  threads,
}: {
  repoSeed: RepoSeed;
  threads: CodexThread[];
}): Promise<RepoGraphReadResult> => {
  const warnings: string[] = [];

  try {
    const { mainWorktreePath, worktrees } = await readWorktrees({
      repoSeed,
      threads,
    });
    const defaultBranch = await readDefaultBranch({ root: repoSeed.root });
    const originFetchWarning = await fetchOriginRefs({ repoSeed });

    if (originFetchWarning !== null) {
      warnings.push(originFetchWarning);
    }

    const [commits, branchSyncChanges, isShallowRepositoryText] =
      await Promise.all([
        readCommits({ repoSeed, threads, worktrees }),
        readGitBranchSyncChanges({ repoSeed }),
        readNullableGitText({
          cwd: repoSeed.root,
          args: ["rev-parse", "--is-shallow-repository"],
        }),
      ]);
    const missingParentCount = readMissingParentCount(commits);

    if (isShallowRepositoryText === "true") {
      warnings.push(
        `${repoSeed.root}: Git repository is shallow, so history can only show commits available locally.`,
      );
    }

    if (commits.length >= COMMIT_READ_LIMIT) {
      warnings.push(
        `${repoSeed.root}: Showing the latest ${COMMIT_READ_LIMIT} commits.`,
      );
    }

    if (missingParentCount > 0) {
      warnings.push(
        `${repoSeed.root}: ${missingParentCount} parent commits are missing from local Git history.`,
      );
    }

    return {
      repo: {
        key: repoSeed.key,
        root: repoSeed.root,
        mainWorktreePath,
        originUrl: repoSeed.originUrl,
        currentBranch: repoSeed.currentBranch,
        defaultBranch,
        branchSyncChanges,
        worktrees,
        commits,
        threadIds: repoSeed.threadIds,
      },
      warnings,
      gitErrors: [],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Git error.";

    return {
      repo: null,
      warnings,
      gitErrors: [`${repoSeed.root}: ${message}`],
    };
  }
};

export const readRepoGraphs = async ({
  threads,
  focusedRepoRoot,
}: {
  threads: CodexThread[];
  focusedRepoRoot: string | null;
}) => {
  const repoSeedReadSummary = await readRepoSeeds({ threads });
  const { repoSeeds } = repoSeedReadSummary;
  const repos: RepoGraph[] = [];
  const warnings: string[] = [];
  const gitErrors: string[] =
    repoSeeds.length === 0 ? repoSeedReadSummary.gitErrors : [];
  const readRepoRoots: string[] = [];
  const focusedRepoSeed =
    repoSeeds.find((repoSeed) => repoSeed.root === focusedRepoRoot) ??
    repoSeeds[0] ??
    null;
  const readRepoGraphResultOfRoot: { [repoRoot: string]: RepoGraphReadResult } =
    {};

  const readUnloadedRepoGraph = (repoSeed: RepoSeed): RepoGraph => {
    return {
      key: repoSeed.key,
      root: repoSeed.root,
      mainWorktreePath: repoSeed.root,
      originUrl: repoSeed.originUrl,
      currentBranch: repoSeed.currentBranch,
      defaultBranch: repoSeed.defaultBranch,
      branchSyncChanges: [],
      worktrees: [],
      commits: [],
      threadIds: repoSeed.threadIds,
    };
  };

  if (focusedRepoSeed !== null) {
    const threadsInRepo = threads.filter((thread) =>
      focusedRepoSeed.threadIds.includes(thread.id),
    );
    readRepoGraphResultOfRoot[focusedRepoSeed.root] =
      await readRepoGraphForSeed({
        repoSeed: focusedRepoSeed,
        threads: threadsInRepo,
      });
    readRepoRoots.push(focusedRepoSeed.root);
  }

  for (const repoSeed of repoSeeds) {
    const readResult = readRepoGraphResultOfRoot[repoSeed.root];

    if (readResult === undefined) {
      repos.push(readUnloadedRepoGraph(repoSeed));
      continue;
    }

    if (readResult.repo === null) {
      repos.push(readUnloadedRepoGraph(repoSeed));
    } else {
      repos.push(readResult.repo);
    }

    warnings.push(...readResult.warnings);
    gitErrors.push(...readResult.gitErrors);
  }

  return { repos, warnings, gitErrors, readRepoRoots };
};

export const readRepoGraphsForRepoRoots = async ({
  threads,
  repos,
  repoRoots,
}: {
  threads: CodexThread[];
  repos: RepoGraph[];
  repoRoots: string[];
}) => {
  const shouldReadRepoOfRoot: { [repoRoot: string]: boolean } = {};
  const warnings: string[] = [];
  const gitErrors: string[] = [];

  for (const repoRoot of repoRoots) {
    shouldReadRepoOfRoot[repoRoot] = true;
  }

  const reposToRead = repos.filter((repo) => {
    if (shouldReadRepoOfRoot[repo.root] === true) {
      return true;
    }

    return false;
  });

  const readResults = await readValuesWithGitReadLimit({
    items: reposToRead,
    readItem: async (repo) => {
      const repoSeed = await readRepoSeedForExistingRepo({ repo });
      const threadsInRepo = threads.filter((thread) =>
        repo.threadIds.includes(thread.id),
      );

      return await readRepoGraphForSeed({ repoSeed, threads: threadsInRepo });
    },
  });
  const changedRepoOfRoot: { [repoRoot: string]: RepoGraph } = {};

  for (const readResult of readResults) {
    if (readResult.repo !== null) {
      changedRepoOfRoot[readResult.repo.root] = readResult.repo;
    }

    warnings.push(...readResult.warnings);
    gitErrors.push(...readResult.gitErrors);
  }

  return {
    repos: repos.map((repo) => changedRepoOfRoot[repo.root] ?? repo),
    warnings,
    gitErrors,
  };
};
