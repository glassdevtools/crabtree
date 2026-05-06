import assert from "node:assert/strict";
import test from "node:test";
import {
  readGitDiffLineCounts,
  readGitDiffLineDisplay,
  readGitDiffMarkerColumnCount,
} from "../src/renderer/gitDiffLines";

test("reads normal diff line markers", () => {
  const markerColumnCount = readGitDiffMarkerColumnCount(
    ["@@ -1,2 +1,2 @@", " line", "-old", "+new"].join("\n"),
  );

  assert.equal(markerColumnCount, 1);
  assert.deepEqual(
    readGitDiffLineDisplay({ line: "+new", markerColumnCount }),
    { changeType: "added", text: "new" },
  );
  assert.deepEqual(
    readGitDiffLineDisplay({ line: "-old", markerColumnCount }),
    { changeType: "removed", text: "old" },
  );
  assert.deepEqual(
    readGitDiffLineDisplay({ line: " line", markerColumnCount }),
    { changeType: "context", text: "line" },
  );
});

test("reads combined diff line markers", () => {
  const diff = ["@@@ -1,2 -1,2 +1,2 @@@", "  context", "--old", "++new"].join(
    "\n",
  );
  const markerColumnCount = readGitDiffMarkerColumnCount(diff);

  assert.equal(markerColumnCount, 2);
  assert.deepEqual(
    readGitDiffLineDisplay({ line: "++new", markerColumnCount }),
    { changeType: "added", text: "new" },
  );
  assert.deepEqual(
    readGitDiffLineDisplay({ line: "--old", markerColumnCount }),
    { changeType: "removed", text: "old" },
  );
  assert.deepEqual(
    readGitDiffLineDisplay({ line: "  context", markerColumnCount }),
    { changeType: "context", text: "context" },
  );
});

test("counts diff lines from the marker columns", () => {
  const diff = [
    "diff --cc app.ts",
    "index 111,222..333",
    "@@@ -1,2 -1,2 +1,3 @@@",
    "  context",
    "--old",
    "++new",
    "+ another",
  ].join("\n");
  const markerColumnCount = readGitDiffMarkerColumnCount(diff);

  assert.deepEqual(readGitDiffLineCounts({ diff, markerColumnCount }), {
    added: 2,
    removed: 1,
  });
});
