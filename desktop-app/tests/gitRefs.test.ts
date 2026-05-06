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
    "crabtree/fix-branch-button",
  );
});

test("adds a branch number when the chat branch name already exists", () => {
  assert.equal(
    readAutomaticBranchName({
      title: "Fix Branch Button",
      fallbackTitle: "thread-1",
      isBranchNameUsedOfBranch: {
        "crabtree/fix-branch-button": true,
        "crabtree/fix-branch-button-2": true,
      },
    }),
    "crabtree/fix-branch-button-3",
  );
});

test("uses the fallback title when the chat title has no branch-safe characters", () => {
  assert.equal(
    readAutomaticBranchName({
      title: "!!!",
      fallbackTitle: "thread-abc-123",
      isBranchNameUsedOfBranch: {},
    }),
    "crabtree/thread-abc-123",
  );
});

test("creates a commit message from an existing branch name", () => {
  assert.equal(
    readAutomaticCommitMessage({
      branch: "feature",
      isCommitMessageUsedOfMessage: {},
    }),
    "crabtree/feature",
  );
});

test("does not double-prefix crabtree branch names for commit messages", () => {
  assert.equal(
    readAutomaticCommitMessage({
      branch: "crabtree/feature",
      isCommitMessageUsedOfMessage: {},
    }),
    "crabtree/feature",
  );
});

test("adds a commit message number when that commit message already exists", () => {
  assert.equal(
    readAutomaticCommitMessage({
      branch: "feature",
      isCommitMessageUsedOfMessage: {
        "crabtree/feature": true,
        "crabtree/feature-2": true,
      },
    }),
    "crabtree/feature-3",
  );
});
