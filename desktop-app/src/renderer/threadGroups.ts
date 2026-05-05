import type {
  CodexThread,
  GitChangeSummary,
  GitWorktree,
} from "../shared/types";

export type ThreadGroup = {
  key: string;
  cwd: string;
  threads: CodexThread[];
};

export type GitChangeCleanState = "clean" | "dirty" | "unknown";

export const readIsCwdInsidePath = ({
  cwd,
  path,
}: {
  cwd: string;
  path: string;
}) => {
  return cwd === path || cwd.startsWith(`${path}/`);
};

export const readIsGitChangeSummaryEmpty = (
  changeSummary: GitChangeSummary,
) => {
  const changedFileCount =
    changeSummary.staged.changedFileCount +
    changeSummary.unstaged.changedFileCount;

  return changedFileCount === 0;
};

export const readGitChangeCleanState = ({
  gitChangesOfCwd,
  cwd,
}: {
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  cwd: string;
}): GitChangeCleanState => {
  const gitChangeSummary = gitChangesOfCwd[cwd];

  if (gitChangeSummary === undefined) {
    return "unknown";
  }

  return readIsGitChangeSummaryEmpty(gitChangeSummary) ? "clean" : "dirty";
};

export const readIsWorktreeCwd = ({
  cwd,
  worktrees,
}: {
  cwd: string;
  worktrees: GitWorktree[];
}) => {
  for (const worktree of worktrees) {
    if (readIsCwdInsidePath({ cwd, path: worktree.path })) {
      return true;
    }
  }

  return false;
};

export const readShouldShowChatOnlyCommitGraphRow = ({
  refs,
  threadIds,
  isChangedWorkingTreeRow,
}: {
  refs: string[];
  threadIds: string[];
  isChangedWorkingTreeRow: boolean;
}) => {
  if (threadIds.length > 0) {
    return true;
  }

  if (isChangedWorkingTreeRow) {
    return true;
  }

  for (const ref of refs) {
    if (ref === "HEAD" || ref.startsWith("HEAD -> ")) {
      return true;
    }
  }

  return false;
};

export const readChangedWorkingTreeCwdsOfSha = ({
  headSha,
  mainWorktreePath,
  worktrees,
  gitChangesOfCwd,
}: {
  headSha: string | null;
  mainWorktreePath: string;
  worktrees: GitWorktree[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
}) => {
  const changedWorkingTreeCwdsOfSha: { [sha: string]: string[] } = {};

  const pushChangedWorkingTreeCwd = ({
    sha,
    cwd,
  }: {
    sha: string | null;
    cwd: string;
  }) => {
    if (
      sha === null ||
      cwd.length === 0 ||
      readGitChangeCleanState({ gitChangesOfCwd, cwd }) !== "dirty"
    ) {
      return;
    }

    if (changedWorkingTreeCwdsOfSha[sha] === undefined) {
      changedWorkingTreeCwdsOfSha[sha] = [];
    }

    changedWorkingTreeCwdsOfSha[sha].push(cwd);
  };

  pushChangedWorkingTreeCwd({ sha: headSha, cwd: mainWorktreePath });

  for (const worktree of worktrees) {
    pushChangedWorkingTreeCwd({ sha: worktree.head, cwd: worktree.path });
  }

  return changedWorkingTreeCwdsOfSha;
};

export const readChangedWorkingTreeShaForCwd = ({
  cwd,
  changedWorkingTreeCwdsOfSha,
}: {
  cwd: string;
  changedWorkingTreeCwdsOfSha: { [sha: string]: string[] };
}) => {
  let changedWorkingTreeSha: string | null = null;
  let changedWorkingTreeCwd: string | null = null;

  for (const sha of Object.keys(changedWorkingTreeCwdsOfSha)) {
    for (const workingTreeCwd of changedWorkingTreeCwdsOfSha[sha]) {
      if (!readIsCwdInsidePath({ cwd, path: workingTreeCwd })) {
        continue;
      }

      if (
        changedWorkingTreeCwd === null ||
        workingTreeCwd.length > changedWorkingTreeCwd.length
      ) {
        changedWorkingTreeSha = sha;
        changedWorkingTreeCwd = workingTreeCwd;
      }
    }
  }

  return changedWorkingTreeSha;
};

export const readDisplayedThreadGroups = ({
  threads,
  changedWorkingTreeCwds,
  worktrees,
  gitChangesOfCwd,
}: {
  threads: CodexThread[];
  changedWorkingTreeCwds: string[];
  worktrees: GitWorktree[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
}) => {
  const threadGroups: ThreadGroup[] = [];
  const groupIndexOfKey: { [key: string]: number } = {};
  const changedWorkingTreeCwdsWithChanges: string[] = [];

  const pushThreadGroup = ({
    key,
    cwd,
    thread,
  }: {
    key: string;
    cwd: string;
    thread: CodexThread | null;
  }) => {
    const groupIndex = groupIndexOfKey[key];

    if (groupIndex !== undefined) {
      if (thread !== null) {
        threadGroups[groupIndex].threads.push(thread);
      }

      return;
    }

    groupIndexOfKey[key] = threadGroups.length;
    threadGroups.push({
      key,
      cwd,
      threads: thread === null ? [] : [thread],
    });
  };

  const readIsCwdChanged = (cwd: string) => {
    return readGitChangeCleanState({ gitChangesOfCwd, cwd }) === "dirty";
  };

  for (const cwd of changedWorkingTreeCwds) {
    if (readIsCwdChanged(cwd)) {
      changedWorkingTreeCwdsWithChanges.push(cwd);
      pushThreadGroup({ key: `cwd:${cwd}`, cwd, thread: null });
    }
  }

  const readChangedWorkingTreeCwdForThread = (thread: CodexThread) => {
    let changedWorkingTreeCwd: string | null = null;

    for (const cwd of changedWorkingTreeCwdsWithChanges) {
      if (!readIsCwdInsidePath({ cwd: thread.cwd, path: cwd })) {
        continue;
      }

      if (
        changedWorkingTreeCwd === null ||
        cwd.length > changedWorkingTreeCwd.length
      ) {
        changedWorkingTreeCwd = cwd;
      }
    }

    return changedWorkingTreeCwd;
  };

  // Chats are grouped by cwd unless a changed working tree owns the whole path.
  for (const thread of threads) {
    const changedWorkingTreeCwd = readChangedWorkingTreeCwdForThread(thread);

    if (changedWorkingTreeCwd !== null) {
      pushThreadGroup({
        key: `cwd:${changedWorkingTreeCwd}`,
        cwd: changedWorkingTreeCwd,
        thread,
      });
      continue;
    }

    const groupKey =
      thread.cwd.length === 0 ? `thread:${thread.id}` : `cwd:${thread.cwd}`;
    pushThreadGroup({ key: groupKey, cwd: thread.cwd, thread });
  }

  const readIsThreadGroupChanged = (threadGroup: ThreadGroup) => {
    return readIsCwdChanged(threadGroup.cwd);
  };

  threadGroups.sort((leftThreadGroup, rightThreadGroup) => {
    const isLeftChanged = readIsThreadGroupChanged(leftThreadGroup);
    const isRightChanged = readIsThreadGroupChanged(rightThreadGroup);

    if (isLeftChanged !== isRightChanged) {
      return isLeftChanged ? -1 : 1;
    }

    const isLeftWorktreeCwd = readIsWorktreeCwd({
      cwd: leftThreadGroup.cwd,
      worktrees,
    });
    const isRightWorktreeCwd = readIsWorktreeCwd({
      cwd: rightThreadGroup.cwd,
      worktrees,
    });

    if (isLeftWorktreeCwd !== isRightWorktreeCwd) {
      return isLeftWorktreeCwd ? 1 : -1;
    }

    return 0;
  });

  return threadGroups;
};
