import assert from "node:assert/strict";
import test from "node:test";
import { readBranchSyncPushWarningMessages } from "../src/renderer/branchSyncWarnings";
import type { GitBranchSyncChange, GitCommit } from "../src/shared/types";

const createCommit = ({
  sha,
  shortSha,
  parents,
  refs,
}: {
  sha: string;
  shortSha: string;
  parents: string[];
  refs: string[];
}) => {
  const commit: GitCommit = {
    sha,
    shortSha,
    parents,
    refs,
    localBranches: [],
    author: "",
    date: "",
    subject: "",
    threadIds: [],
  };

  return commit;
};

test("warns before pushing a branch update that removes the last branch or tag from the old origin tip", () => {
  const mainSha = "1111111111111111111111111111111111111111";
  const oldFeatureSha = "2222222222222222222222222222222222222222";
  const branchSyncChanges: GitBranchSyncChange[] = [
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "feature",
      localSha: mainSha,
      originSha: oldFeatureSha,
    },
  ];
  const commits = [
    createCommit({
      sha: mainSha,
      shortSha: "1111111",
      parents: [],
      refs: ["HEAD -> main", "origin/main"],
    }),
    createCommit({
      sha: oldFeatureSha,
      shortSha: "2222222",
      parents: [],
      refs: ["origin/feature"],
    }),
  ];

  assert.deepEqual(
    readBranchSyncPushWarningMessages({
      branchSyncChanges,
      commits,
    }),
    [
      "2222222 will disappear from the tree because feature won't be there to point to it anymore.",
    ],
  );
});

test("warns before pushing when only HEAD keeps the old origin tip visible", () => {
  const mainSha = "1111111111111111111111111111111111111111";
  const oldFeatureSha = "2222222222222222222222222222222222222222";
  const branchSyncChanges: GitBranchSyncChange[] = [
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "feature",
      localSha: mainSha,
      originSha: oldFeatureSha,
    },
  ];
  const commits = [
    createCommit({
      sha: mainSha,
      shortSha: "1111111",
      parents: [],
      refs: ["HEAD -> main", "origin/main"],
    }),
    createCommit({
      sha: oldFeatureSha,
      shortSha: "2222222",
      parents: [],
      refs: ["HEAD", "origin/feature"],
    }),
  ];

  assert.deepEqual(
    readBranchSyncPushWarningMessages({
      branchSyncChanges,
      commits,
    }),
    [
      "2222222 will disappear from the tree because feature won't be there to point to it anymore.",
    ],
  );
});

test("warns before pushing when all origin branches move away from the old tip together", () => {
  const mainSha = "1111111111111111111111111111111111111111";
  const oldSha = "2222222222222222222222222222222222222222";
  const branchSyncChanges: GitBranchSyncChange[] = [
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "main",
      localSha: mainSha,
      originSha: oldSha,
    },
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "backup",
      localSha: mainSha,
      originSha: oldSha,
    },
  ];
  const commits = [
    createCommit({
      sha: mainSha,
      shortSha: "1111111",
      parents: [],
      refs: ["HEAD"],
    }),
    createCommit({
      sha: oldSha,
      shortSha: "2222222",
      parents: [],
      refs: ["origin/main", "origin/backup"],
    }),
  ];

  assert.deepEqual(
    readBranchSyncPushWarningMessages({
      branchSyncChanges,
      commits,
    }),
    [
      "2222222 will disappear from the tree because main and backup won't be there to point to it anymore.",
    ],
  );
});

test("warns before pushing a branch deletion that removes the last branch or tag from the old origin tip", () => {
  const oldFeatureSha = "2222222222222222222222222222222222222222";
  const branchSyncChanges: GitBranchSyncChange[] = [
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "feature",
      localSha: null,
      originSha: oldFeatureSha,
    },
  ];
  const commits = [
    createCommit({
      sha: oldFeatureSha,
      shortSha: "2222222",
      parents: [],
      refs: ["origin/feature"],
    }),
  ];

  assert.deepEqual(
    readBranchSyncPushWarningMessages({
      branchSyncChanges,
      commits,
    }),
    [
      "2222222 will disappear from the tree because feature won't be there to point to it anymore.",
    ],
  );
});

test("does not warn before pushing a branch update that keeps the old origin tip reachable", () => {
  const oldFeatureSha = "2222222222222222222222222222222222222222";
  const newFeatureSha = "3333333333333333333333333333333333333333";
  const branchSyncChanges: GitBranchSyncChange[] = [
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "feature",
      localSha: newFeatureSha,
      originSha: oldFeatureSha,
    },
  ];
  const commits = [
    createCommit({
      sha: newFeatureSha,
      shortSha: "3333333",
      parents: [oldFeatureSha],
      refs: [],
    }),
    createCommit({
      sha: oldFeatureSha,
      shortSha: "2222222",
      parents: [],
      refs: ["origin/feature"],
    }),
  ];

  assert.deepEqual(
    readBranchSyncPushWarningMessages({
      branchSyncChanges,
      commits,
    }),
    [],
  );
});

test("does not warn before pushing when another origin branch keeps the old tip visible", () => {
  const mainSha = "1111111111111111111111111111111111111111";
  const oldFeatureSha = "2222222222222222222222222222222222222222";
  const branchSyncChanges: GitBranchSyncChange[] = [
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "feature",
      localSha: mainSha,
      originSha: oldFeatureSha,
    },
  ];
  const commits = [
    createCommit({
      sha: mainSha,
      shortSha: "1111111",
      parents: [],
      refs: ["HEAD -> main", "origin/main"],
    }),
    createCommit({
      sha: oldFeatureSha,
      shortSha: "2222222",
      parents: [],
      refs: ["origin/feature", "origin/backup"],
    }),
  ];

  assert.deepEqual(
    readBranchSyncPushWarningMessages({
      branchSyncChanges,
      commits,
    }),
    [],
  );
});

test("does not warn before pushing when a local tag keeps the old tip visible", () => {
  const mainSha = "1111111111111111111111111111111111111111";
  const oldFeatureSha = "2222222222222222222222222222222222222222";
  const branchSyncChanges: GitBranchSyncChange[] = [
    {
      repoRoot: "/repo",
      gitRefType: "branch",
      name: "feature",
      localSha: mainSha,
      originSha: oldFeatureSha,
    },
  ];
  const commits = [
    createCommit({
      sha: mainSha,
      shortSha: "1111111",
      parents: [],
      refs: ["HEAD -> main", "origin/main"],
    }),
    createCommit({
      sha: oldFeatureSha,
      shortSha: "2222222",
      parents: [],
      refs: ["origin/feature", "tag: keep-feature"],
    }),
  ];

  assert.deepEqual(
    readBranchSyncPushWarningMessages({
      branchSyncChanges,
      commits,
    }),
    [],
  );
});
