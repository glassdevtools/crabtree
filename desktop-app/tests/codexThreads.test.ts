import assert from "node:assert/strict";
import test from "node:test";
import {
  convertCodexThreadStatus,
  readCodexThreadFromAppServerValue,
  readCodexThreadStatusChangeFromAppServerNotification,
} from "../src/main/codexThreads";

test("converts active codex app-server status variants", () => {
  assert.deepEqual(convertCodexThreadStatus("running"), {
    type: "active",
    activeFlags: [],
  });
  assert.deepEqual(
    convertCodexThreadStatus({
      type: "active",
      active_flags: ["running", 4, "waitingOnApproval"],
    }),
    {
      type: "active",
      activeFlags: ["running", "waitingOnApproval"],
    },
  );
});

test("reads codex app-server status change notifications", () => {
  assert.deepEqual(
    readCodexThreadStatusChangeFromAppServerNotification({
      thread_id: "thread-1",
      status: "running",
    }),
    {
      threadId: "thread-1",
      status: { type: "active", activeFlags: [] },
    },
  );
  assert.deepEqual(
    readCodexThreadStatusChangeFromAppServerNotification({
      thread: {
        id: "thread-2",
        status: { type: "idle" },
      },
    }),
    {
      threadId: "thread-2",
      status: { type: "idle" },
    },
  );
});

test("reads active codex app-server thread values", () => {
  assert.deepEqual(
    readCodexThreadFromAppServerValue({
      id: "active-thread",
      name: "Real app-server title",
      preview: "first user prompt",
      cwd: "/repo/app-server",
      path: "/Users/test/.codex/sessions/rollout-active-thread.jsonl",
      source: "vscode",
      modelProvider: "openai",
      createdAt: 1777605812,
      updatedAt: 1777606097,
      archived: false,
      status: { type: "active", activeFlags: ["running"] },
      gitInfo: {
        sha: "abc123",
        branch: "main",
        originUrl: "https://github.com/example/repo.git",
      },
    }),
    {
      id: "active-thread",
      name: "Real app-server title",
      preview: "first user prompt",
      cwd: "/repo/app-server",
      path: "/Users/test/.codex/sessions/rollout-active-thread.jsonl",
      source: "vscode",
      modelProvider: "openai",
      createdAt: 1777605812,
      updatedAt: 1777606097,
      archived: false,
      status: { type: "active", activeFlags: ["running"] },
      gitInfo: {
        sha: "abc123",
        branch: "main",
        originUrl: "https://github.com/example/repo.git",
      },
    },
  );
});

test("reads stopped codex app-server thread statuses", () => {
  assert.deepEqual(
    readCodexThreadFromAppServerValue({
      id: "idle-thread",
      preview: "idle prompt",
      cwd: "/repo/idle",
      model_provider: "openai",
      createdAt: "2026-05-01T01:00:00.000Z",
      updatedAt: "2026-05-01T01:01:00.000Z",
      status: { type: "idle" },
      git: {
        commit_hash: "def456",
        branch: "dev",
        repository_url: "https://github.com/example/idle.git",
      },
    }),
    {
      id: "idle-thread",
      name: null,
      preview: "idle prompt",
      cwd: "/repo/idle",
      path: null,
      source: "unknown",
      modelProvider: "openai",
      createdAt: 1777597200,
      updatedAt: 1777597260,
      archived: false,
      status: { type: "idle" },
      gitInfo: {
        sha: "def456",
        branch: "dev",
        originUrl: "https://github.com/example/idle.git",
      },
    },
  );
});

test("rejects invalid codex app-server thread values", () => {
  assert.equal(
    readCodexThreadFromAppServerValue({ preview: "missing id" }),
    null,
  );
  assert.equal(readCodexThreadFromAppServerValue(null), null);
});
