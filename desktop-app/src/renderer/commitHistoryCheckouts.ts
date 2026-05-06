import type { GitChangeSummary, GitWorktree } from "../shared/types";
import { readGitChangeCleanState, readIsCwdInsidePath } from "./threadGroups";

export type CommitHistoryCheckout = {
  path: string;
  branch: string | null;
  isMainWorktree: boolean;
  worktree: GitWorktree | null;
};

type CommitHistoryCheckoutWithDirtyState = CommitHistoryCheckout & {
  isDirty: boolean;
};

export const readCommitHistoryCheckoutsForCommit = ({
  commitSha,
  isMainHeadCommit,
  mainWorktreePath,
  currentBranch,
  worktrees,
  gitChangesOfCwd,
}: {
  commitSha: string;
  isMainHeadCommit: boolean;
  mainWorktreePath: string;
  currentBranch: string | null;
  worktrees: GitWorktree[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
}) => {
  const checkouts: CommitHistoryCheckoutWithDirtyState[] = [];

  if (isMainHeadCommit) {
    checkouts.push({
      path: mainWorktreePath,
      branch: currentBranch,
      isMainWorktree: true,
      worktree: null,
      isDirty:
        readGitChangeCleanState({
          gitChangesOfCwd,
          cwd: mainWorktreePath,
        }) === "dirty",
    });
  }

  for (const worktree of worktrees) {
    if (worktree.head !== commitSha) {
      continue;
    }

    checkouts.push({
      path: worktree.path,
      branch: worktree.branch,
      isMainWorktree: false,
      worktree,
      isDirty:
        readGitChangeCleanState({
          gitChangesOfCwd,
          cwd: worktree.path,
        }) === "dirty",
    });
  }

  return checkouts;
};

export const readCommitHistoryRowCheckouts = ({
  checkouts,
  changedWorkingTreeCwd,
}: {
  checkouts: CommitHistoryCheckoutWithDirtyState[];
  changedWorkingTreeCwd: string | null;
}) => {
  if (changedWorkingTreeCwd === null) {
    return checkouts.filter((checkout) => !checkout.isDirty);
  }

  let owningCheckoutPath: string | null = null;

  for (const checkout of checkouts) {
    if (
      !checkout.isDirty ||
      !readIsCwdInsidePath({ cwd: changedWorkingTreeCwd, path: checkout.path })
    ) {
      continue;
    }

    if (
      owningCheckoutPath === null ||
      checkout.path.length > owningCheckoutPath.length
    ) {
      owningCheckoutPath = checkout.path;
    }
  }

  return checkouts.filter(
    (checkout) => checkout.isDirty && checkout.path === owningCheckoutPath,
  );
};

export const readDirtyCommitHistoryCheckoutBranches = (
  checkouts: CommitHistoryCheckoutWithDirtyState[],
) => {
  const isDirtyBranchOfBranch: { [branch: string]: boolean } = {};

  for (const checkout of checkouts) {
    if (!checkout.isDirty || checkout.branch === null) {
      continue;
    }

    isDirtyBranchOfBranch[checkout.branch] = true;
  }

  return isDirtyBranchOfBranch;
};

export const readDuplicateCheckedOutBranchOfBranch = ({
  currentBranch,
  worktrees,
}: {
  currentBranch: string | null;
  worktrees: GitWorktree[];
}) => {
  const checkoutCountOfBranch: { [branch: string]: number } = {};
  const duplicateCheckedOutBranchOfBranch: { [branch: string]: boolean } = {};

  const pushCheckedOutBranch = (branch: string | null) => {
    if (branch === null) {
      return;
    }

    const checkoutCount = (checkoutCountOfBranch[branch] ?? 0) + 1;
    checkoutCountOfBranch[branch] = checkoutCount;

    if (checkoutCount > 1) {
      duplicateCheckedOutBranchOfBranch[branch] = true;
    }
  };

  pushCheckedOutBranch(currentBranch);

  for (const worktree of worktrees) {
    pushCheckedOutBranch(worktree.branch);
  }

  return duplicateCheckedOutBranchOfBranch;
};
