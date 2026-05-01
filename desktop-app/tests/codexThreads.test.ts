import assert from "node:assert/strict";
import test from "node:test";
import { convertThreadStatus } from "../src/main/codexThreads";

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
