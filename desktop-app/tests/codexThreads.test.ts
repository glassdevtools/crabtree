import assert from "node:assert/strict";
import test from "node:test";
import {
  convertThreadStatus,
  readLatestRolloutTaskEventFromText,
  readRolloutTaskStatusFromText,
} from "../src/main/codexThreads";

test("converts active thread status with string active flags", () => {
  const status = convertThreadStatus({
    type: "active",
    activeFlags: ["waitingOnApproval", 5, "running"],
  });

  assert.deepEqual(status, {
    type: "active",
    activeFlags: ["waitingOnApproval", "running"],
  });
});

test("converts missing or unknown thread status to not loaded", () => {
  assert.deepEqual(convertThreadStatus(null), { type: "notLoaded" });
  assert.deepEqual(convertThreadStatus({ type: "paused" }), {
    type: "notLoaded",
  });
});

test("reads the latest rollout task event from jsonl text", () => {
  const text = [
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_started" },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete" },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_started" },
    }),
  ].join("\n");

  assert.equal(readLatestRolloutTaskEventFromText(text), "taskStarted");
});

test("ignores partial rollout jsonl lines while reading task events", () => {
  const text = [
    "partial json line",
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete" },
    }),
  ].join("\n");

  assert.equal(readLatestRolloutTaskEventFromText(text), "taskComplete");
});

test("marks only recent rollout starts as active", () => {
  const nowMs = Date.parse("2026-04-29T12:00:00.000Z");
  const text = JSON.stringify({
    timestamp: "2026-04-29T11:59:00.000Z",
    type: "event_msg",
    payload: { type: "task_started" },
  });

  assert.deepEqual(
    readRolloutTaskStatusFromText({
      text,
      latestActivityMs: Date.parse("2026-04-29T11:59:30.000Z"),
      nowMs,
    }),
    {
      type: "active",
      activeFlags: [],
    },
  );
});

test("keeps older rollout starts active while the rollout is still changing", () => {
  const nowMs = Date.parse("2026-04-29T12:00:00.000Z");
  const text = JSON.stringify({
    timestamp: "2026-04-29T11:30:00.000Z",
    type: "event_msg",
    payload: { type: "task_started" },
  });

  assert.deepEqual(
    readRolloutTaskStatusFromText({
      text,
      latestActivityMs: Date.parse("2026-04-29T11:59:30.000Z"),
      nowMs,
    }),
    {
      type: "active",
      activeFlags: [],
    },
  );
});

test("does not keep stale rollout starts active", () => {
  const nowMs = Date.parse("2026-04-29T12:00:00.000Z");
  const text = JSON.stringify({
    timestamp: "2026-04-29T11:57:59.000Z",
    type: "event_msg",
    payload: { type: "task_started" },
  });

  assert.equal(
    readRolloutTaskStatusFromText({
      text,
      latestActivityMs: Date.parse("2026-04-29T11:57:59.000Z"),
      nowMs,
    }),
    null,
  );
});

test("does not mark rollout starts active without timestamps", () => {
  const nowMs = Date.parse("2026-04-29T12:00:00.000Z");
  const text = JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started" },
  });

  assert.equal(
    readRolloutTaskStatusFromText({
      text,
      latestActivityMs: Date.parse("2026-04-29T11:59:30.000Z"),
      nowMs,
    }),
    null,
  );
});
