export type CommitHistoryRowLayout = {
  top: number;
  center: number;
  height: number;
};

export const readCommitHistoryRowHeight = ({
  lineCount,
  rowHeight,
}: {
  lineCount: number;
  rowHeight: number;
}) => {
  return Math.max(1, lineCount) * rowHeight;
};

export const readCommitHistoryRowLayouts = ({
  rows,
  rowHeight,
}: {
  rows: { lineCount: number }[];
  rowHeight: number;
}) => {
  const rowLayouts: CommitHistoryRowLayout[] = [];
  let totalHeight = 0;

  for (const row of rows) {
    const height = readCommitHistoryRowHeight({
      lineCount: row.lineCount,
      rowHeight,
    });

    rowLayouts.push({
      top: totalHeight,
      center: totalHeight + height / 2,
      height,
    });
    totalHeight += height;
  }

  return {
    rowLayouts,
    totalHeight: Math.max(rowHeight, totalHeight),
  };
};
