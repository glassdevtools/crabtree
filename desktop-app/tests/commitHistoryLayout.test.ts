import assert from "node:assert/strict";
import test from "node:test";
import {
  readCommitGridTemplateColumns,
  readCommitHistoryRowHeight,
  readCommitHistoryRowLayouts,
  readCommitHistoryTableWidth,
  replaceCommitHistoryColumnWidth,
} from "../src/renderer/commitHistoryLayout";

const columnWidths = {
  graph: 300,
  code: 50,
  chats: 70,
  branchTags: 240,
  description: 294,
  commit: 84,
  author: 150,
  date: 170,
};

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

test("puts chats between code actions and branches", () => {
  assert.equal(
    readCommitGridTemplateColumns(columnWidths),
    "300px 50px 70px 240px 294px 84px 150px 170px",
  );
});

test("includes the chats column in the commit table width", () => {
  assert.equal(readCommitHistoryTableWidth(columnWidths), 1358);
});

test("resizes the chats column without changing code actions", () => {
  assert.deepEqual(
    replaceCommitHistoryColumnWidth({
      columnWidths,
      columnKey: "chats",
      width: 128,
    }),
    {
      ...columnWidths,
      chats: 128,
    },
  );
});
