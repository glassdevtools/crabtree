import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  convertCodexThreadStatus,
  readCodexThreadFromAppServerValue,
  readCodexThreadStatusChangeFromAppServerNotification,
} from "../src/main/codexThreads";

const createTempRolloutFile = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), "crabtree-codex-rollout-"));
  const path = join(dir, "rollout.jsonl");

  writeFileSync(path, text);

  return { dir, path };
};

const removeTempRolloutDir = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
};

const createRolloutLine = (value: unknown) => {
  return `${JSON.stringify(value)}\n`;
};

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

test("reads active codex rollout task markers", () => {
  const rolloutFile = createTempRolloutFile(
    createRolloutLine({ type: "session_meta", payload: {} }) +
      createRolloutLine({
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1" },
      }) +
      createRolloutLine({
        type: "event_msg",
        payload: { type: "token_count" },
      }),
  );

  try {
    const thread = readCodexThreadFromAppServerValue({
      id: "active-rollout-thread",
      preview: "active prompt",
      cwd: "/repo/active-rollout",
      path: rolloutFile.path,
      modelProvider: "openai",
      status: { type: "notLoaded" },
    });

    assert.notEqual(thread, null);

    if (thread === null) {
      return;
    }

    assert.deepEqual(thread.status, {
      type: "active",
      activeFlags: [],
    });
  } finally {
    removeTempRolloutDir(rolloutFile.dir);
  }
});

test("updates codex rollout task marker cache when a task completes", () => {
  const rolloutFile = createTempRolloutFile(
    createRolloutLine({
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1" },
    }),
  );

  try {
    const activeThread = readCodexThreadFromAppServerValue({
      id: "cached-rollout-thread",
      preview: "cached prompt",
      cwd: "/repo/cached-rollout",
      path: rolloutFile.path,
      modelProvider: "openai",
      status: { type: "notLoaded" },
    });

    appendFileSync(
      rolloutFile.path,
      createRolloutLine({
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1" },
      }),
    );

    const idleThread = readCodexThreadFromAppServerValue({
      id: "cached-rollout-thread",
      preview: "cached prompt",
      cwd: "/repo/cached-rollout",
      path: rolloutFile.path,
      modelProvider: "openai",
      status: { type: "notLoaded" },
    });

    assert.notEqual(activeThread, null);
    assert.notEqual(idleThread, null);

    if (activeThread === null || idleThread === null) {
      return;
    }

    assert.deepEqual(activeThread.status, {
      type: "active",
      activeFlags: [],
    });
    assert.deepEqual(idleThread.status, { type: "idle" });
  } finally {
    removeTempRolloutDir(rolloutFile.dir);
  }
});

test("keeps active app-server status ahead of completed rollout markers", () => {
  const rolloutFile = createTempRolloutFile(
    createRolloutLine({
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1" },
    }) +
      createRolloutLine({
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1" },
      }),
  );

  try {
    const thread = readCodexThreadFromAppServerValue({
      id: "app-server-active-thread",
      preview: "app-server prompt",
      cwd: "/repo/app-server-active",
      path: rolloutFile.path,
      modelProvider: "openai",
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
    });

    assert.notEqual(thread, null);

    if (thread === null) {
      return;
    }

    assert.deepEqual(thread.status, {
      type: "active",
      activeFlags: ["waitingOnApproval"],
    });
  } finally {
    removeTempRolloutDir(rolloutFile.dir);
  }
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
      providerId: "codex",
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
      providerId: "codex",
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
