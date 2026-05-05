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

export const readIsGitChangeSummaryEmpty = (
  changeSummary: GitChangeSummary,
) => {
  const changedFileCount =
    changeSummary.staged.changedFileCount +
    changeSummary.unstaged.changedFileCount;

  return changedFileCount === 0 && changeSummary.conflictCount === 0;
};

export const readIsWorktreeCwd = ({
  cwd,
  worktrees,
}: {
  cwd: string;
  worktrees: GitWorktree[];
}) => {
  for (const worktree of worktrees) {
    if (cwd === worktree.path || cwd.startsWith(`${worktree.path}/`)) {
      return true;
    }
  }

  return false;
};

export const readDisplayedThreadGroups = ({
  threads,
  worktrees,
  gitChangesOfCwd,
}: {
  threads: CodexThread[];
  worktrees: GitWorktree[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
}) => {
  const threadGroups: ThreadGroup[] = [];
  const groupIndexOfKey: { [key: string]: number } = {};

  // Chats are grouped by cwd so chats that share a working directory also share one change count.
  for (const thread of threads) {
    const groupKey =
      thread.cwd.length === 0 ? `thread:${thread.id}` : `cwd:${thread.cwd}`;
    const groupIndex = groupIndexOfKey[groupKey];

    if (groupIndex !== undefined) {
      threadGroups[groupIndex].threads.push(thread);
      continue;
    }

    groupIndexOfKey[groupKey] = threadGroups.length;
    threadGroups.push({ key: groupKey, cwd: thread.cwd, threads: [thread] });
  }

  const readIsThreadGroupChanged = (threadGroup: ThreadGroup) => {
    const gitChangeSummary = gitChangesOfCwd[threadGroup.cwd];

    return (
      gitChangeSummary !== undefined &&
      !readIsGitChangeSummaryEmpty(gitChangeSummary)
    );
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
