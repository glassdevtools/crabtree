import assert from "node:assert/strict";
import test from "node:test";
import {
  readDuplicateCheckedOutBranchOfBranch,
  readCommitHistoryCheckoutsForCommit,
  readCommitHistoryRowCheckouts,
} from "../src/renderer/commitHistoryCheckouts";
import type { GitChangeSummary, GitWorktree } from "../src/shared/types";

const CLEAN_CHANGE_SUMMARY: GitChangeSummary = {
  staged: {
    added: 0,
    removed: 0,
    changedFileCount: 0,
  },
  unstaged: {
    added: 0,
    removed: 0,
    changedFileCount: 0,
  },
  conflictCount: 0,
};

const DIRTY_CHANGE_SUMMARY: GitChangeSummary = {
  staged: {
    added: 1,
    removed: 0,
    changedFileCount: 1,
  },
  unstaged: {
    added: 0,
    removed: 0,
    changedFileCount: 0,
  },
  conflictCount: 0,
};

const createWorktree = ({
  path,
  head,
  branch,
}: {
  path: string;
  head: string;
  branch: string | null;
}) => {
  const worktree: GitWorktree = {
    path,
    head,
    branch,
    isDetached: false,
    threadIds: [],
  };

  return worktree;
};

test("moves a dirty main checkout from the commit row to the changed row", () => {
  const checkouts = readCommitHistoryCheckoutsForCommit({
    commitSha: "head-sha",
    isMainHeadCommit: true,
    mainWorktreePath: "/repo/main",
    currentBranch: "main",
    worktrees: [],
    gitChangesOfCwd: {
      "/repo/main": DIRTY_CHANGE_SUMMARY,
    },
  });

  assert.deepEqual(
    readCommitHistoryRowCheckouts({
      checkouts,
      changedWorkingTreeCwd: null,
    }).map((checkout) => checkout.path),
    [],
  );
  assert.deepEqual(
    readCommitHistoryRowCheckouts({
      checkouts,
      changedWorkingTreeCwd: "/repo/main",
    }).map((checkout) => ({
      path: checkout.path,
      branch: checkout.branch,
      isMainWorktree: checkout.isMainWorktree,
    })),
    [{ path: "/repo/main", branch: "main", isMainWorktree: true }],
  );
});

test("shows the same branch on clean and dirty duplicate checkout rows", () => {
  const checkouts = readCommitHistoryCheckoutsForCommit({
    commitSha: "topic-sha",
    isMainHeadCommit: false,
    mainWorktreePath: "/repo/main",
    currentBranch: "main",
    worktrees: [
      createWorktree({
        path: "/repo/clean-topic",
        head: "topic-sha",
        branch: "topic",
      }),
      createWorktree({
        path: "/repo/dirty-topic",
        head: "topic-sha",
        branch: "topic",
      }),
    ],
    gitChangesOfCwd: {
      "/repo/clean-topic": CLEAN_CHANGE_SUMMARY,
      "/repo/dirty-topic": DIRTY_CHANGE_SUMMARY,
    },
  });

  assert.deepEqual(
    readCommitHistoryRowCheckouts({
      checkouts,
      changedWorkingTreeCwd: null,
    }).map((checkout) => ({
      path: checkout.path,
      branch: checkout.branch,
    })),
    [{ path: "/repo/clean-topic", branch: "topic" }],
  );
  assert.deepEqual(
    readCommitHistoryRowCheckouts({
      checkouts,
      changedWorkingTreeCwd: "/repo/dirty-topic",
    }).map((checkout) => ({
      path: checkout.path,
      branch: checkout.branch,
    })),
    [{ path: "/repo/dirty-topic", branch: "topic" }],
  );
});

test("uses the most specific dirty checkout for nested worktree paths", () => {
  const checkouts = readCommitHistoryCheckoutsForCommit({
    commitSha: "shared-sha",
    isMainHeadCommit: true,
    mainWorktreePath: "/repo/main",
    currentBranch: "main",
    worktrees: [
      createWorktree({
        path: "/repo/main/worktrees/topic",
        head: "shared-sha",
        branch: "topic",
      }),
    ],
    gitChangesOfCwd: {
      "/repo/main": DIRTY_CHANGE_SUMMARY,
      "/repo/main/worktrees/topic": DIRTY_CHANGE_SUMMARY,
    },
  });

  assert.deepEqual(
    readCommitHistoryRowCheckouts({
      checkouts,
      changedWorkingTreeCwd: "/repo/main/worktrees/topic",
    }).map((checkout) => ({
      path: checkout.path,
      branch: checkout.branch,
      isMainWorktree: checkout.isMainWorktree,
    })),
    [
      {
        path: "/repo/main/worktrees/topic",
        branch: "topic",
        isMainWorktree: false,
      },
    ],
  );
});

test("keeps a dirty detached checkout branchless", () => {
  const checkouts = readCommitHistoryCheckoutsForCommit({
    commitSha: "head-sha",
    isMainHeadCommit: false,
    mainWorktreePath: "/repo/main",
    currentBranch: "main",
    worktrees: [
      createWorktree({
        path: "/repo/detached",
        head: "head-sha",
        branch: null,
      }),
    ],
    gitChangesOfCwd: {
      "/repo/detached": DIRTY_CHANGE_SUMMARY,
    },
  });

  assert.deepEqual(
    readCommitHistoryRowCheckouts({
      checkouts,
      changedWorkingTreeCwd: "/repo/detached",
    }).map((checkout) => ({
      path: checkout.path,
      branch: checkout.branch,
    })),
    [{ path: "/repo/detached", branch: null }],
  );
});

test("detects branches checked out in multiple places", () => {
  assert.deepEqual(
    readDuplicateCheckedOutBranchOfBranch({
      currentBranch: "topic",
      worktrees: [
        createWorktree({
          path: "/repo/topic-a",
          head: "topic-sha",
          branch: "topic",
        }),
        createWorktree({
          path: "/repo/other",
          head: "other-sha",
          branch: "other",
        }),
        createWorktree({
          path: "/repo/other-again",
          head: "other-sha",
          branch: "other",
        }),
      ],
    }),
    {
      topic: true,
      other: true,
    },
  );
});
