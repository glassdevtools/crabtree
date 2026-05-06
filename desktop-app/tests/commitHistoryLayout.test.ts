import assert from "node:assert/strict";
import test from "node:test";
import {
  readCommitHistoryRowHeight,
  readCommitHistoryRowLayouts,
} from "../src/renderer/commitHistoryLayout";

test("keeps rows at least one line tall", () => {
  assert.equal(
    readCommitHistoryRowHeight({
      lineCount: 0,
      rowHeight: 20,
    }),
    20,
  );
});

test("sizes multi-line commit rows without adding graph rows", () => {
  const layout = readCommitHistoryRowLayouts({
    rows: [{ lineCount: 1 }, { lineCount: 3 }, { lineCount: 1 }],
    rowHeight: 20,
  });

  assert.deepEqual(layout, {
    rowLayouts: [
      { top: 0, center: 10, height: 20 },
      { top: 20, center: 50, height: 60 },
      { top: 80, center: 90, height: 20 },
    ],
    totalHeight: 100,
  });
});
