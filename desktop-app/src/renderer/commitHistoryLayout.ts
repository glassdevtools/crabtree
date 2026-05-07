export type CommitHistoryColumnWidths = {
  graph: number;
  code: number;
  chats: number;
  branchTags: number;
  description: number;
  commit: number;
  author: number;
  date: number;
};
export type CommitHistoryColumnResizeKey = keyof CommitHistoryColumnWidths;

export type CommitHistoryRowLayout = {
  top: number;
  center: number;
  height: number;
};

export const readCommitGridTemplateColumns = (
  columnWidths: CommitHistoryColumnWidths,
) => {
  return `${columnWidths.graph}px ${columnWidths.code}px ${columnWidths.chats}px ${columnWidths.branchTags}px ${columnWidths.description}px ${columnWidths.commit}px ${columnWidths.author}px ${columnWidths.date}px`;
};

export const readCommitHistoryTableWidth = (
  columnWidths: CommitHistoryColumnWidths,
) => {
  return (
    columnWidths.graph +
    columnWidths.code +
    columnWidths.chats +
    columnWidths.branchTags +
    columnWidths.description +
    columnWidths.commit +
    columnWidths.author +
    columnWidths.date
  );
};

export const replaceCommitHistoryColumnWidth = ({
  columnWidths,
  columnKey,
  width,
}: {
  columnWidths: CommitHistoryColumnWidths;
  columnKey: CommitHistoryColumnResizeKey;
  width: number;
}) => {
  switch (columnKey) {
    case "graph":
      return { ...columnWidths, graph: width };
    case "code":
      return { ...columnWidths, code: width };
    case "chats":
      return { ...columnWidths, chats: width };
    case "branchTags":
      return { ...columnWidths, branchTags: width };
    case "description":
      return { ...columnWidths, description: width };
    case "commit":
      return { ...columnWidths, commit: width };
    case "author":
      return { ...columnWidths, author: width };
    case "date":
      return { ...columnWidths, date: width };
  }
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
