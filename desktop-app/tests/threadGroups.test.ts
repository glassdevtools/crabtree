import assert from "node:assert/strict";
import test from "node:test";
import {
  readChangedWorkingTreeCwdsOfSha,
  readChangedWorkingTreeShaForCwd,
  readDisplayedThreadGroups,
  readGitChangeCleanState,
  readIsGitChangeSummaryEmpty,
  readShouldShowChatOnlyCommitGraphRow,
} from "../src/renderer/threadGroups";
import type { ChatThread, GitChangeSummary } from "../src/shared/types";

const EMPTY_CHANGE_SUMMARY: GitChangeSummary = {
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

const ADDED_CHANGE_SUMMARY: GitChangeSummary = {
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

const REMOVED_CHANGE_SUMMARY: GitChangeSummary = {
  staged: {
    added: 0,
    removed: 0,
    changedFileCount: 0,
  },
  unstaged: {
    added: 0,
    removed: 1,
    changedFileCount: 1,
  },
  conflictCount: 0,
};

const BINARY_CHANGE_SUMMARY: GitChangeSummary = {
  staged: {
    added: 0,
    removed: 0,
    changedFileCount: 0,
  },
  unstaged: {
    added: 0,
    removed: 0,
    changedFileCount: 1,
  },
  conflictCount: 0,
};

const CONFLICT_CHANGE_SUMMARY: GitChangeSummary = {
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
  conflictCount: 1,
};

const createThread = ({ id, cwd }: { id: string; cwd: string }) => {
  const thread: ChatThread = {
    id,
    providerId: "codex",
    name: null,
    preview: "",
    cwd,
    path: null,
    source: "",
    modelProvider: "",
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    status: { type: "idle" },
    gitInfo: null,
  };

  return thread;
};

test("orders changed cwd chat groups before unchanged groups", () => {
  const threadGroups = readDisplayedThreadGroups({
    threads: [
      createThread({ id: "unchanged-root", cwd: "/repo/root" }),
      createThread({ id: "changed-worktree", cwd: "/repo/worktree" }),
      createThread({ id: "changed-root-a", cwd: "/repo/changed" }),
      createThread({ id: "unchanged-empty", cwd: "" }),
      createThread({ id: "changed-root-b", cwd: "/repo/changed" }),
      createThread({ id: "empty-root", cwd: "/repo/empty" }),
      createThread({ id: "unchanged-worktree", cwd: "/repo/worktree-clean" }),
    ],
    changedWorkingTreeCwds: [],
    worktrees: [
      {
        path: "/repo/worktree",
        head: null,
        branch: null,
        isDetached: false,
        threadIds: ["changed-worktree"],
      },
      {
        path: "/repo/worktree-clean",
        head: null,
        branch: null,
        isDetached: false,
        threadIds: ["unchanged-worktree"],
      },
    ],
    gitChangesOfCwd: {
      "/repo/worktree": ADDED_CHANGE_SUMMARY,
      "/repo/changed": REMOVED_CHANGE_SUMMARY,
      "/repo/empty": EMPTY_CHANGE_SUMMARY,
    },
  });

  assert.deepEqual(
    threadGroups.map((threadGroup) => threadGroup.key),
    [
      "cwd:/repo/changed",
      "cwd:/repo/worktree",
      "cwd:/repo/root",
      "thread:unchanged-empty",
      "cwd:/repo/empty",
      "cwd:/repo/worktree-clean",
    ],
  );
  assert.deepEqual(
    threadGroups[0].threads.map((thread) => thread.id),
    ["changed-root-a", "changed-root-b"],
  );
});

test("adds changed working tree groups without chats", () => {
  const threadGroups = readDisplayedThreadGroups({
    threads: [],
    changedWorkingTreeCwds: ["/repo/root"],
    worktrees: [],
    gitChangesOfCwd: {
      "/repo/root": ADDED_CHANGE_SUMMARY,
    },
  });

  assert.deepEqual(
    threadGroups.map((threadGroup) => ({
      key: threadGroup.key,
      cwd: threadGroup.cwd,
      threadIds: threadGroup.threads.map((thread) => thread.id),
    })),
    [{ key: "cwd:/repo/root", cwd: "/repo/root", threadIds: [] }],
  );
});

test("moves chats into their changed working tree group", () => {
  const threadGroups = readDisplayedThreadGroups({
    threads: [
      createThread({ id: "repo-thread", cwd: "/repo/root/package" }),
      createThread({ id: "other-thread", cwd: "/repo/other" }),
    ],
    changedWorkingTreeCwds: ["/repo/root"],
    worktrees: [],
    gitChangesOfCwd: {
      "/repo/root": ADDED_CHANGE_SUMMARY,
    },
  });

  assert.deepEqual(
    threadGroups.map((threadGroup) => ({
      key: threadGroup.key,
      cwd: threadGroup.cwd,
      threadIds: threadGroup.threads.map((thread) => thread.id),
    })),
    [
      {
        key: "cwd:/repo/root",
        cwd: "/repo/root",
        threadIds: ["repo-thread"],
      },
      {
        key: "cwd:/repo/other",
        cwd: "/repo/other",
        threadIds: ["other-thread"],
      },
    ],
  );
});

test("maps changed main and linked worktree paths to their commits", () => {
  assert.deepEqual(
    readChangedWorkingTreeCwdsOfSha({
      headSha: "main-sha",
      mainWorktreePath: "/repo/main",
      worktrees: [
        {
          path: "/repo/worktree",
          head: "worktree-sha",
          branch: "topic",
          isDetached: false,
          threadIds: [],
        },
        {
          path: "/repo/clean-worktree",
          head: "clean-sha",
          branch: "clean",
          isDetached: false,
          threadIds: [],
        },
        {
          path: "/repo/missing-head",
          head: null,
          branch: null,
          isDetached: true,
          threadIds: [],
        },
      ],
      gitChangesOfCwd: {
        "/repo/main": ADDED_CHANGE_SUMMARY,
        "/repo/worktree": REMOVED_CHANGE_SUMMARY,
        "/repo/clean-worktree": EMPTY_CHANGE_SUMMARY,
        "/repo/missing-head": ADDED_CHANGE_SUMMARY,
      },
    }),
    {
      "main-sha": ["/repo/main"],
      "worktree-sha": ["/repo/worktree"],
    },
  );
});

test("finds the changed working tree commit for a chat cwd", () => {
  const changedWorkingTreeCwdsOfSha = {
    "main-sha": ["/repo/main"],
    "nested-worktree-sha": ["/repo/main/worktrees/topic"],
    "worktree-sha": ["/repo/worktree"],
  };

  assert.equal(
    readChangedWorkingTreeShaForCwd({
      cwd: "/repo/worktree/package",
      changedWorkingTreeCwdsOfSha,
    }),
    "worktree-sha",
  );
  assert.equal(
    readChangedWorkingTreeShaForCwd({
      cwd: "/repo/main/package",
      changedWorkingTreeCwdsOfSha,
    }),
    "main-sha",
  );
  assert.equal(
    readChangedWorkingTreeShaForCwd({
      cwd: "/repo/main/worktrees/topic/package",
      changedWorkingTreeCwdsOfSha,
    }),
    "nested-worktree-sha",
  );
  assert.equal(
    readChangedWorkingTreeShaForCwd({
      cwd: "/repo/clean/package",
      changedWorkingTreeCwdsOfSha,
    }),
    null,
  );
});

test("reads clean, dirty, and unknown git change states", () => {
  const gitChangesOfCwd: { [cwd: string]: GitChangeSummary } = {
    "/repo/clean": EMPTY_CHANGE_SUMMARY,
    "/repo/dirty": ADDED_CHANGE_SUMMARY,
  };

  assert.equal(
    readGitChangeCleanState({ gitChangesOfCwd, cwd: "/repo/clean" }),
    "clean",
  );
  assert.equal(
    readGitChangeCleanState({ gitChangesOfCwd, cwd: "/repo/dirty" }),
    "dirty",
  );
  assert.equal(
    readGitChangeCleanState({ gitChangesOfCwd, cwd: "/repo/missing" }),
    "unknown",
  );
});

test("treats file-only change summaries as changed", () => {
  assert.equal(readIsGitChangeSummaryEmpty(BINARY_CHANGE_SUMMARY), false);
});

test("treats conflict change summaries as changed", () => {
  assert.equal(readIsGitChangeSummaryEmpty(CONFLICT_CHANGE_SUMMARY), false);
});

test("keeps HEAD rows visible in chat-only history", () => {
  assert.equal(
    readShouldShowChatOnlyCommitGraphRow({
      refs: ["HEAD -> main"],
      threadIds: [],
      isChangedWorkingTreeRow: false,
    }),
    true,
  );
});

test("keeps changed working tree rows visible in chat-only history", () => {
  assert.equal(
    readShouldShowChatOnlyCommitGraphRow({
      refs: [],
      threadIds: [],
      isChangedWorkingTreeRow: true,
    }),
    true,
  );
});

test("hides normal no-chat rows in chat-only history", () => {
  assert.equal(
    readShouldShowChatOnlyCommitGraphRow({
      refs: ["origin/main"],
      threadIds: [],
      isChangedWorkingTreeRow: false,
    }),
    false,
  );
});
