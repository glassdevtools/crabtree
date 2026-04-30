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

test("warns before pushing a branch update that drops the old origin tip from the graph", () => {
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
      worktrees: [],
    }),
    [
      "Are you sure you want to push? Moving feature branch from 2222222 will drop that commit from the graph.",
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
      worktrees: [],
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
      worktrees: [],
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
      worktrees: [],
    }),
    [],
  );
});
