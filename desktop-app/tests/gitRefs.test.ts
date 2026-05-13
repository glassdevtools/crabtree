import assert from "node:assert/strict";
import test from "node:test";
import {
  readAutomaticBranchName,
  readAutomaticCommitMessage,
  readCreatedGitRefName,
} from "../src/renderer/gitRefs";

test("cleans manually entered Git ref names without lowercasing them", () => {
  assert.equal(readCreatedGitRefName(" Fix: Thing "), "Fix-Thing");
});

test("creates a lowercase branch name from a chat title", () => {
  assert.equal(
    readAutomaticBranchName({
      title: "Fix Branch Button!",
      fallbackTitle: "thread-1",
      isBranchNameUsedOfBranch: {},
    }),
    "branchmaster/fix-branch-button",
  );
});

test("adds a branch number when the chat branch name already exists", () => {
  assert.equal(
    readAutomaticBranchName({
      title: "Fix Branch Button",
      fallbackTitle: "thread-1",
      isBranchNameUsedOfBranch: {
        "branchmaster/fix-branch-button": true,
        "branchmaster/fix-branch-button-2": true,
      },
    }),
    "branchmaster/fix-branch-button-3",
  );
});

test("uses the fallback title when the chat title has no branch-safe characters", () => {
  assert.equal(
    readAutomaticBranchName({
      title: "!!!",
      fallbackTitle: "thread-abc-123",
      isBranchNameUsedOfBranch: {},
    }),
    "branchmaster/thread-abc-123",
  );
});

test("creates a commit message from an existing branch name", () => {
  assert.equal(
    readAutomaticCommitMessage({
      branch: "feature",
      isCommitMessageUsedOfMessage: {},
    }),
    "branchmaster/feature",
  );
});

test("does not double-prefix branchmaster branch names for commit messages", () => {
  assert.equal(
    readAutomaticCommitMessage({
      branch: "branchmaster/feature",
      isCommitMessageUsedOfMessage: {},
    }),
    "branchmaster/feature",
  );
});

test("adds a commit message number when that commit message already exists", () => {
  assert.equal(
    readAutomaticCommitMessage({
      branch: "feature",
      isCommitMessageUsedOfMessage: {
        "branchmaster/feature": true,
        "branchmaster/feature-2": true,
      },
    }),
    "branchmaster/feature-3",
  );
});
