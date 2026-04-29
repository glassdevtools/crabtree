import assert from "node:assert/strict";
import test from "node:test";
import {
  convertThreadStatus,
  readLatestRolloutTaskEventFromText,
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
