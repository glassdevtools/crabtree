import {
  Bot,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DragEvent, FormEvent, MouseEvent, PointerEvent } from "react";
import type {
  CodexThread,
  DashboardData,
  GitBranchTagChange,
  GitChangeSummary,
  GitCommit,
  GitMergeRequest,
  GitWorktree,
  RepoGraph,
} from "../shared/types";

// The history view is a SourceTree-style row table. Git owns the commits; the renderer only assigns lanes.
// TODO: AI-PICKED-VALUE: These graph sizes and colors are initial SourceTree-like choices for dense commit rows.
const COMMIT_GRAPH_ROW_HEIGHT = 32;
const COMMIT_GRAPH_LANE_WIDTH = 22;
const COMMIT_GRAPH_PADDING_LEFT = 18;
const COMMIT_GRAPH_MIN_WIDTH = 300;
const COMMIT_GRAPH_DOT_RADIUS = 6;
const COMMIT_GRAPH_GRAY_COLOR = "#8b929c";
const COMMIT_GRAPH_BOT_ICON_SIZE = 14;
const COMMIT_GRAPH_CHAT_ICON_SIZE = 14;
const COMMIT_GRAPH_CODE_ICON_SIZE = 14;
const COMMIT_GRAPH_COMMIT_ICON_SIZE = 12;
const COMMIT_GRAPH_TRASH_ICON_SIZE = 13;
const COMMIT_GRAPH_ACTION_HIT_SIZE = 14;
// TODO: AI-PICKED-VALUE: The action group uses the same right padding as the table cells.
const COMMIT_GRAPH_ACTION_RIGHT_PADDING = 10;
const COMMIT_GRAPH_ACTION_ICON_SPACING = 20;
const COMMIT_GRAPH_LANE_ACTION_GAP = 18;
const COMMIT_GRAPH_CHANGE_TEXT_MIN_WIDTH = 46;
// TODO: AI-PICKED-VALUE: This approximates the 10px monospace SVG count text so large counts reserve enough room.
const COMMIT_GRAPH_CHANGE_TEXT_CHARACTER_WIDTH = 7;
const COMMIT_GRAPH_CHANGE_TEXT_GAP = 6;
const COMMIT_GRAPH_ROW_CONNECTION_INSET_RATIO = 0;
// Dashboard reads touch Codex and Git, so automatic refreshes are spaced out and share the manual refresh path.
// TODO: AI-PICKED-VALUE: Refreshing every 5 seconds keeps branch/worktree state current without making Git reads constant.
const DASHBOARD_REFRESH_INTERVAL_MS = 5000;
// TODO: AI-PICKED-VALUE: Four seconds is long enough to read a short success toast without requiring manual dismissal.
const SUCCESS_MESSAGE_TIMEOUT_MS = 4000;
const COMMIT_GRAPH_COLORS = [
  "#c53a13",
  "#0a84ff",
  "#00a6a6",
  "#ff9f0a",
  "#6f52ed",
  "#30a46c",
  "#ff6b45",
  "#8e6c00",
];
const EMPTY_GIT_CHANGE_SUMMARY: GitChangeSummary = {
  staged: {
    added: 0,
    removed: 0,
  },
  unstaged: {
    added: 0,
    removed: 0,
  },
};

const readTotalGitChangeSummary = (changeSummary: GitChangeSummary) => {
  return {
    added: changeSummary.staged.added + changeSummary.unstaged.added,
    removed: changeSummary.staged.removed + changeSummary.unstaged.removed,
  };
};

const readIsGitChangeSummaryEmpty = (changeSummary: GitChangeSummary) => {
  const totalChangeSummary = readTotalGitChangeSummary(changeSummary);

  return totalChangeSummary.added === 0 && totalChangeSummary.removed === 0;
};

const readBranchTagChangesForRepo = ({
  branchTagChanges,
  repoBranchTagChanges,
  repoRoot,
}: {
  branchTagChanges: GitBranchTagChange[];
  repoBranchTagChanges: GitBranchTagChange[];
  repoRoot: string;
}) => {
  const branchTagChangeOfBranch: { [branch: string]: GitBranchTagChange } = {};

  for (const repoBranchTagChange of repoBranchTagChanges) {
    branchTagChangeOfBranch[repoBranchTagChange.branch] = repoBranchTagChange;
  }

  for (const branchTagChange of branchTagChanges) {
    if (branchTagChange.repoRoot !== repoRoot) {
      continue;
    }

    const repoBranchTagChange = branchTagChangeOfBranch[branchTagChange.branch];
    const oldSha = repoBranchTagChange?.oldSha ?? branchTagChange.oldSha;

    if (oldSha === branchTagChange.newSha) {
      delete branchTagChangeOfBranch[branchTagChange.branch];
      continue;
    }

    branchTagChangeOfBranch[branchTagChange.branch] = {
      ...branchTagChange,
      oldSha,
    };
  }

  return Object.values(branchTagChangeOfBranch);
};

// TODO: AI-PICKED-VALUE: These column widths match the current table layout closely enough while making drag resizing concrete.
const COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS = {
  graph: 300,
  branchTags: 320,
  description: 420,
  commit: 84,
  author: 150,
  date: 170,
};
const COMMIT_HISTORY_MIN_COLUMN_WIDTHS = {
  graph: 300,
  branchTags: 140,
  description: 180,
  commit: 64,
  author: 90,
  date: 120,
};

type CommitHistoryColumnKey =
  | "graph"
  | "branchTags"
  | "description"
  | "commit"
  | "author"
  | "date";

type CommitHistoryColumnWidths = {
  graph: number;
  branchTags: number;
  description: number;
  commit: number;
  author: number;
  date: number;
};

type CommitHistoryColumnResize = {
  columnKey: CommitHistoryColumnKey;
  startClientX: number;
  startColumnWidths: CommitHistoryColumnWidths;
  startWidth: number;
  currentWidth: number;
};

type CommitMergeDrag = {
  rowId: string;
  repoRoot: string;
  sha: string;
  shortSha: string;
};

type CommitMergeConfirmation = {
  gitMergeRequest: GitMergeRequest;
  fromShortSha: string;
  toShortSha: string;
};

type BranchPointerDrag = {
  repoRoot: string;
  branch: string;
  oldSha: string;
  oldShortSha: string;
};

type BranchPointerMove = {
  repoRoot: string;
  branch: string;
  oldSha: string;
  oldShortSha: string;
  newSha: string;
  newShortSha: string;
};

type BranchDeleteTarget = {
  branch: string;
  oldSha: string;
};

type BranchTagChangeAction = "push" | "reset";

type BranchTagChangeConfirmation = {
  action: BranchTagChangeAction;
  repoRoot: string;
};

type CommitMergeTarget = {
  targetBranch: string | null;
  targetWorktreePath: string | null;
};

type CommitGraphRowKind = "commit" | "worktree" | "chat" | "head";

type CommitGraphRow = {
  id: string;
  kind: CommitGraphRowKind;
  commit: GitCommit;
  worktree: GitWorktree | null;
  threadIds: string[];
  lane: number;
  colorIndex: number;
  rowIndex: number;
};

type CommitGraphItem = {
  id: string;
  kind: CommitGraphRowKind;
  commit: GitCommit;
  worktree: GitWorktree | null;
  sha: string;
  parents: string[];
  threadIds: string[];
};

type CommitGraphLane = {
  sha: string;
  colorIndex: number;
};

type CommitGraphSegment = {
  fromLane: number;
  toLane: number;
  fromRowIndex: number;
  toRowIndex: number;
  colorIndex: number;
  isMergeSegment: boolean;
  isGraySegment: boolean;
};

type CommitGraph = {
  rows: CommitGraphRow[];
  segments: CommitGraphSegment[];
  laneCount: number;
};

const readCommitGraphRowThread = (
  row: CommitGraphRow,
  threadOfId: { [id: string]: CodexThread },
) => {
  const threadId = row.threadIds[0];

  if (threadId === undefined) {
    return null;
  }

  return threadOfId[threadId] ?? null;
};

const readCommitGraphRowCwd = (
  row: CommitGraphRow,
  threadOfId: { [id: string]: CodexThread },
  repoRoot: string,
) => {
  if (row.kind === "worktree" && row.worktree !== null) {
    return row.worktree.path;
  }

  if (row.kind === "head") {
    return repoRoot;
  }

  const thread = readCommitGraphRowThread(row, threadOfId);

  if (thread === null || thread.cwd.length === 0) {
    return null;
  }

  return thread.cwd;
};

const formatDate = (timestamp: number) => {
  if (timestamp === 0) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
};

const formatCommitDate = (date: string) => {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
};

const threadTitle = (thread: CodexThread) => {
  if (thread.name !== null && thread.name.length > 0) {
    return thread.name;
  }

  if (thread.preview.length > 0) {
    return thread.preview;
  }

  return thread.id;
};

const readCommitGraphColor = (colorIndex: number) => {
  return COMMIT_GRAPH_COLORS[colorIndex % COMMIT_GRAPH_COLORS.length];
};

const readCommitGraphColorIndex = (graphKey: string) => {
  let colorIndex = 0;

  // New lanes start from the graph key so refreshes keep colors stable while the graph still carries colors through parent lanes.
  for (let charIndex = 0; charIndex < graphKey.length; charIndex += 1) {
    colorIndex =
      (colorIndex * 31 + graphKey.charCodeAt(charIndex)) %
      COMMIT_GRAPH_COLORS.length;
  }

  return colorIndex;
};

const readCommitGraphX = (lane: number) => {
  return COMMIT_GRAPH_PADDING_LEFT + lane * COMMIT_GRAPH_LANE_WIDTH;
};

const readCommitGraphY = (rowIndex: number) => {
  return rowIndex * COMMIT_GRAPH_ROW_HEIGHT + COMMIT_GRAPH_ROW_HEIGHT / 2;
};

const readCommitGraphTextWidth = (text: string) => {
  return text.length * COMMIT_GRAPH_CHANGE_TEXT_CHARACTER_WIDTH;
};

const readCommitGraphChangeCountWidth = (
  changeSummary: GitChangeSummary["staged"],
) => {
  const addedText = `+${changeSummary.added}`;
  const removedText = `-${changeSummary.removed}`;

  return Math.max(
    COMMIT_GRAPH_CHANGE_TEXT_MIN_WIDTH,
    readCommitGraphTextWidth(addedText) +
      COMMIT_GRAPH_CHANGE_TEXT_GAP +
      readCommitGraphTextWidth(removedText),
  );
};

const readCommitGraphWidth = ({
  laneCount,
  actionWidth,
}: {
  laneCount: number;
  actionWidth: number;
}) => {
  const actionAreaWidth =
    actionWidth === 0 ? 0 : COMMIT_GRAPH_LANE_ACTION_GAP + actionWidth;

  return Math.max(
    COMMIT_GRAPH_MIN_WIDTH,
    COMMIT_GRAPH_PADDING_LEFT * 2 +
      laneCount * COMMIT_GRAPH_LANE_WIDTH +
      actionAreaWidth,
  );
};

const readCommitGraphRowActionWidth = ({
  row,
  repoRoot,
  threadOfId,
  gitChangesOfCwd,
  isWorktreeMergedOfPath,
}: {
  row: CommitGraphRow;
  repoRoot: string;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  isWorktreeMergedOfPath: { [path: string]: boolean };
}) => {
  const worktree = row.worktree;
  const rowCwd = readCommitGraphRowCwd(row, threadOfId, repoRoot);
  const storedChangeSummary =
    rowCwd === null ? undefined : gitChangesOfCwd[rowCwd];
  const changeSummary = storedChangeSummary ?? EMPTY_GIT_CHANGE_SUMMARY;
  const totalChangeSummary = readTotalGitChangeSummary(changeSummary);
  const shouldShowChangeCount =
    totalChangeSummary.added > 0 || totalChangeSummary.removed > 0;
  const shouldShowTrash =
    row.kind === "worktree" &&
    worktree !== null &&
    worktree.path !== repoRoot &&
    storedChangeSummary !== undefined &&
    readIsGitChangeSummaryEmpty(changeSummary) &&
    isWorktreeMergedOfPath[worktree.path] === true;
  const thread = readCommitGraphRowThread(row, threadOfId);
  const canOpenPath = thread !== null && thread.cwd.length > 0;
  const canOpenCommitMessage = rowCwd !== null;
  const shouldShowCommitAction = canOpenCommitMessage && shouldShowChangeCount;
  let iconCount = 0;

  if (shouldShowTrash) {
    iconCount += 1;
  }

  if (canOpenPath) {
    iconCount += 1;
  }

  if (row.threadIds.length > 0) {
    iconCount += 1;
  }

  if (shouldShowCommitAction) {
    iconCount += 1;
  }

  if (shouldShowChangeCount) {
    const changeCountWidth =
      readCommitGraphChangeCountWidth(totalChangeSummary);

    if (iconCount === 0) {
      return COMMIT_GRAPH_ACTION_RIGHT_PADDING + changeCountWidth;
    }

    return (
      COMMIT_GRAPH_ACTION_RIGHT_PADDING +
      iconCount * COMMIT_GRAPH_ACTION_ICON_SPACING +
      changeCountWidth
    );
  }

  if (iconCount === 0) {
    return 0;
  }

  return (
    COMMIT_GRAPH_ACTION_RIGHT_PADDING +
    COMMIT_GRAPH_ACTION_HIT_SIZE +
    (iconCount - 1) * COMMIT_GRAPH_ACTION_ICON_SPACING
  );
};

const readCommitGridTemplateColumns = (
  columnWidths: CommitHistoryColumnWidths,
) => {
  return `${columnWidths.graph}px ${columnWidths.branchTags}px ${columnWidths.description}px ${columnWidths.commit}px ${columnWidths.author}px ${columnWidths.date}px`;
};

const readCommitHistoryTableWidth = (
  columnWidths: CommitHistoryColumnWidths,
) => {
  return (
    columnWidths.graph +
    columnWidths.branchTags +
    columnWidths.description +
    columnWidths.commit +
    columnWidths.author +
    columnWidths.date
  );
};

const replaceCommitHistoryColumnWidth = ({
  columnWidths,
  columnKey,
  width,
}: {
  columnWidths: CommitHistoryColumnWidths;
  columnKey: CommitHistoryColumnKey;
  width: number;
}) => {
  switch (columnKey) {
    case "graph":
      return { ...columnWidths, graph: width };
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

const updateCommitHistoryColumnStyles = (
  commitHistory: HTMLDivElement,
  columnWidths: CommitHistoryColumnWidths,
) => {
  commitHistory.style.setProperty(
    "--commit-history-grid-template-columns",
    readCommitGridTemplateColumns(columnWidths),
  );
  commitHistory.style.setProperty(
    "--commit-history-table-width",
    `${readCommitHistoryTableWidth(columnWidths)}px`,
  );
};

const cleanRefName = (ref: string) => {
  const headPrefix = "HEAD -> ";
  const tagPrefix = "tag: ";

  if (ref.startsWith(headPrefix)) {
    return ref.slice(headPrefix.length);
  }

  if (ref.startsWith(tagPrefix)) {
    return ref.slice(tagPrefix.length);
  }

  return ref;
};

const readIsHeadRef = (ref: string) => {
  return ref === "HEAD" || ref.startsWith("HEAD -> ");
};

const logCommitMerge = (message: string, value: unknown) => {
  console.info(`[Molt Tree merge] ${message}`, value);
};

const createCommitGraph = (
  commits: GitCommit[],
  worktreesOfHead: { [sha: string]: GitWorktree[] },
) => {
  const graphItems: CommitGraphItem[] = [];
  const colorIndexOfSha: { [sha: string]: number } = {};
  const lanes: CommitGraphLane[] = [];
  const rows: CommitGraphRow[] = [];
  const segments: CommitGraphSegment[] = [];
  const isSegmentAddedOfKey: { [key: string]: boolean } = {};
  let laneCount = 1;

  const readNewLaneColorIndex = ({
    graphKey,
    lanesToCheck,
    parentLanes,
  }: {
    graphKey: string;
    lanesToCheck: CommitGraphLane[];
    parentLanes: CommitGraphLane[];
  }) => {
    const preferredColorIndex = readCommitGraphColorIndex(graphKey);
    const isColorIndexUsed: { [colorIndex: number]: boolean } = {};

    for (const laneItem of lanesToCheck) {
      isColorIndexUsed[laneItem.colorIndex % COMMIT_GRAPH_COLORS.length] = true;
    }

    for (const laneItem of parentLanes) {
      isColorIndexUsed[laneItem.colorIndex % COMMIT_GRAPH_COLORS.length] = true;
    }

    for (
      let colorOffset = 0;
      colorOffset < COMMIT_GRAPH_COLORS.length;
      colorOffset += 1
    ) {
      const colorIndex =
        (preferredColorIndex + colorOffset) % COMMIT_GRAPH_COLORS.length;

      if (isColorIndexUsed[colorIndex] === true) {
        continue;
      }

      return colorIndex;
    }

    return preferredColorIndex;
  };

  for (const commit of commits) {
    const worktrees = worktreesOfHead[commit.sha] ?? [];
    const isOwnedByWorktreeOfThreadId: { [threadId: string]: boolean } = {};
    const isHeadCommit = commit.refs.some((ref) => readIsHeadRef(ref));

    for (const worktree of worktrees) {
      for (const threadId of worktree.threadIds) {
        isOwnedByWorktreeOfThreadId[threadId] = true;
      }
    }

    for (const worktree of worktrees) {
      graphItems.push({
        id: `worktree:${worktree.path}:${commit.sha}`,
        kind: "worktree",
        commit,
        worktree,
        sha: `worktree:${worktree.path}:${commit.sha}`,
        parents: [commit.sha],
        threadIds: worktree.threadIds,
      });
    }

    if (isHeadCommit) {
      const threadIds = commit.threadIds.filter(
        (threadId) => isOwnedByWorktreeOfThreadId[threadId] !== true,
      );

      graphItems.push({
        id: `head:${commit.sha}`,
        kind: "head",
        commit,
        worktree: null,
        sha: commit.sha,
        parents: commit.parents,
        threadIds,
      });
      continue;
    }

    for (const threadId of commit.threadIds) {
      if (isOwnedByWorktreeOfThreadId[threadId] === true) {
        continue;
      }

      graphItems.push({
        id: `chat:${threadId}:${commit.sha}`,
        kind: "chat",
        commit,
        worktree: null,
        sha: `chat:${threadId}:${commit.sha}`,
        parents: [commit.sha],
        threadIds: [threadId],
      });
    }

    graphItems.push({
      id: `commit:${commit.sha}`,
      kind: "commit",
      commit,
      worktree: null,
      sha: commit.sha,
      parents: commit.parents,
      threadIds: [],
    });
  }

  const addSegment = ({
    fromLane,
    toLane,
    fromRowIndex,
    toRowIndex,
    colorIndex,
    isMergeSegment,
    isGraySegment,
  }: CommitGraphSegment) => {
    const key = `${fromLane}:${toLane}:${fromRowIndex}:${toRowIndex}:${colorIndex}:${isMergeSegment}:${isGraySegment}`;

    if (isSegmentAddedOfKey[key] === true) {
      return;
    }

    isSegmentAddedOfKey[key] = true;
    segments.push({
      fromLane,
      toLane,
      fromRowIndex,
      toRowIndex,
      colorIndex,
      isMergeSegment,
      isGraySegment,
    });
  };

  // Worktrees and chats are added to the same row list before lane assignment, so they render like normal branch heads.
  for (const graphItem of graphItems) {
    let lane = lanes.findIndex((laneItem) => laneItem.sha === graphItem.sha);

    if (lane === -1) {
      let colorIndex = colorIndexOfSha[graphItem.sha];

      if (colorIndex === undefined) {
        colorIndex = readNewLaneColorIndex({
          graphKey: graphItem.sha,
          lanesToCheck: lanes,
          parentLanes: [],
        });
        colorIndexOfSha[graphItem.sha] = colorIndex;
      }

      lane = lanes.length;
      lanes[lane] = { sha: graphItem.sha, colorIndex };
    }

    const commitLane = lanes[lane];
    const rowIndex = rows.length;
    rows.push({
      id: graphItem.id,
      kind: graphItem.kind,
      commit: graphItem.commit,
      worktree: graphItem.worktree,
      threadIds: graphItem.threadIds,
      lane,
      colorIndex: commitLane.colorIndex,
      rowIndex,
    });
    colorIndexOfSha[graphItem.sha] = commitLane.colorIndex;
    laneCount = Math.max(laneCount, lanes.length, lane + 1);

    const nextLanes = [...lanes];
    nextLanes.splice(lane, 1);
    const parentLanes: CommitGraphLane[] = [];

    for (
      let parentIndex = 0;
      parentIndex < graphItem.parents.length;
      parentIndex += 1
    ) {
      const parent = graphItem.parents[parentIndex];
      const existingParentLane = nextLanes.findIndex(
        (laneItem) => laneItem.sha === parent,
      );
      const pendingParentLane = parentLanes.findIndex(
        (laneItem) => laneItem.sha === parent,
      );

      if (existingParentLane !== -1 || pendingParentLane !== -1) {
        continue;
      }

      let parentColorIndex = colorIndexOfSha[parent];

      if (parentColorIndex === undefined) {
        if (
          (graphItem.kind === "commit" || graphItem.kind === "head") &&
          parentIndex === 0
        ) {
          parentColorIndex = commitLane.colorIndex;
        } else {
          parentColorIndex = readNewLaneColorIndex({
            graphKey: parent,
            lanesToCheck: nextLanes,
            parentLanes,
          });
        }

        colorIndexOfSha[parent] = parentColorIndex;
      }

      parentLanes.push({ sha: parent, colorIndex: parentColorIndex });
    }

    nextLanes.splice(lane, 0, ...parentLanes);
    laneCount = Math.max(laneCount, nextLanes.length);
    const nextLaneIndexOfSha: { [sha: string]: number } = {};

    for (
      let nextLaneIndex = 0;
      nextLaneIndex < nextLanes.length;
      nextLaneIndex += 1
    ) {
      const laneItem = nextLanes[nextLaneIndex];
      nextLaneIndexOfSha[laneItem.sha] = nextLaneIndex;
    }

    for (let oldLaneIndex = 0; oldLaneIndex < lanes.length; oldLaneIndex += 1) {
      const laneItem = lanes[oldLaneIndex];

      if (oldLaneIndex === lane) {
        continue;
      }

      const nextLaneIndex = nextLaneIndexOfSha[laneItem.sha];

      if (nextLaneIndex === undefined) {
        continue;
      }

      addSegment({
        fromLane: oldLaneIndex,
        toLane: nextLaneIndex,
        fromRowIndex: rowIndex,
        toRowIndex: rowIndex + 1,
        colorIndex: laneItem.colorIndex,
        isMergeSegment: false,
        isGraySegment: false,
      });
    }

    for (
      let parentIndex = 0;
      parentIndex < graphItem.parents.length;
      parentIndex += 1
    ) {
      const parent = graphItem.parents[parentIndex];
      const nextLaneIndex = nextLaneIndexOfSha[parent];

      if (nextLaneIndex === undefined) {
        continue;
      }

      const parentColorIndex = colorIndexOfSha[parent];

      addSegment({
        fromLane: lane,
        toLane: nextLaneIndex,
        fromRowIndex: rowIndex,
        toRowIndex: rowIndex + 1,
        colorIndex:
          parentColorIndex === undefined
            ? commitLane.colorIndex
            : parentColorIndex,
        isMergeSegment: parentIndex > 0,
        isGraySegment: graphItem.kind === "chat",
      });
    }

    lanes.splice(0, lanes.length, ...nextLanes);
    laneCount = Math.max(laneCount, lanes.length);
  }

  const graph: CommitGraph = {
    rows,
    segments,
    laneCount,
  };

  return graph;
};

const createThreadOfId = (threads: CodexThread[]) => {
  const threadOfId: { [id: string]: CodexThread } = {};

  for (const thread of threads) {
    threadOfId[thread.id] = thread;
  }

  return threadOfId;
};

const BranchTags = ({
  refs,
  localBranches,
  worktrees,
  threads,
  shouldShowHeadTag,
  repoRoot,
  commitSha,
  commitShortSha,
  isBranchDeleteSafeOfBranch,
  openBranchDeleteModal,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  refs: string[];
  localBranches: string[];
  worktrees: GitWorktree[];
  threads: CodexThread[];
  shouldShowHeadTag: boolean;
  repoRoot: string;
  commitSha: string;
  commitShortSha: string;
  isBranchDeleteSafeOfBranch: { [branch: string]: boolean };
  openBranchDeleteModal: (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
    oldSha: string,
  ) => void;
  startBranchPointerDrag: ({
    event,
    branch,
    oldSha,
    oldShortSha,
  }: {
    event: DragEvent<HTMLElement>;
    branch: string;
    oldSha: string;
    oldShortSha: string;
  }) => void;
  finishBranchPointerDrag: () => void;
}) => {
  if (refs.length === 0 && worktrees.length === 0 && threads.length === 0) {
    return null;
  }

  const isHead = shouldShowHeadTag && refs.some((ref) => readIsHeadRef(ref));
  const headRef = refs.find((ref) => ref.startsWith("HEAD -> "));
  const headBranch = headRef === undefined ? null : cleanRefName(headRef);
  const normalRefs = refs.filter((ref) => !readIsHeadRef(ref));
  const orderedRefs = [
    ...normalRefs.filter((ref) => !ref.startsWith("tag: ")),
    ...normalRefs.filter((ref) => ref.startsWith("tag: ")),
  ];
  const isLocalBranchOfName: { [name: string]: boolean } = {};

  for (const localBranch of localBranches) {
    isLocalBranchOfName[localBranch] = true;
  }

  const openCodePath = async (
    event: MouseEvent<HTMLButtonElement>,
    path: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    await window.molttree.openVSCodePath(path);
  };
  const openThread = async (
    event: MouseEvent<HTMLButtonElement>,
    threadId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    await window.molttree.openCodexThread(threadId);
  };

  const readWorktreeTagText = (path: string) => {
    if (path === repoRoot) {
      return "HEAD";
    }

    const pathParts = path.split("/");
    const worktreesIndex = pathParts.lastIndexOf("worktrees");
    const hash = pathParts[worktreesIndex + 1];

    if (worktreesIndex >= 0 && hash !== undefined && hash.length > 0) {
      return `worktrees/${hash}`;
    }

    return `Worktree at ${path}`;
  };

  return (
    <div className="commit-label-list">
      {isHead ? (
        <button
          className="commit-head"
          title="HEAD"
          type="button"
          key="HEAD"
          draggable={headBranch !== null}
          onMouseDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            if (headBranch === null) {
              return;
            }

            startBranchPointerDrag({
              event,
              branch: headBranch,
              oldSha: commitSha,
              oldShortSha: commitShortSha,
            });
          }}
          onDragEnd={finishBranchPointerDrag}
          onClick={(event) => openCodePath(event, repoRoot)}
        >
          <ExternalLink size={13} />
          <span>HEAD</span>
        </button>
      ) : null}
      {worktrees.map((worktree) => (
        <button
          className="commit-worktree"
          title={worktree.path}
          type="button"
          key={worktree.path}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => openCodePath(event, worktree.path)}
        >
          <ExternalLink size={13} />
          <span>{readWorktreeTagText(worktree.path)}</span>
        </button>
      ))}
      {threads.map((thread) => {
        const title = threadTitle(thread);

        return (
          <button
            className="commit-thread"
            title={title}
            type="button"
            key={thread.id}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => openThread(event, thread.id)}
          >
            <MessageSquare size={13} />
            <span>{title}</span>
          </button>
        );
      })}
      {orderedRefs.map((ref) => {
        const refName = cleanRefName(ref);
        const isLocalBranch = isLocalBranchOfName[refName] === true;
        const isTag = ref.startsWith("tag: ");
        const isOriginBranch = refName.startsWith("origin/");
        let refClassName = "commit-ref commit-ref-local";
        const shouldShowDelete =
          isLocalBranch && isBranchDeleteSafeOfBranch[refName] === true;

        if (isOriginBranch) {
          refClassName = "commit-ref commit-ref-origin";
        }

        if (isTag) {
          refClassName = "commit-ref commit-ref-tag";
        }

        return (
          <span
            className={
              isLocalBranch
                ? `${refClassName} commit-ref-draggable`
                : refClassName
            }
            title={ref}
            key={ref}
            draggable={isLocalBranch}
            onDragStart={(event) => {
              if (!isLocalBranch) {
                return;
              }

              startBranchPointerDrag({
                event,
                branch: refName,
                oldSha: commitSha,
                oldShortSha: commitShortSha,
              });
            }}
            onDragEnd={finishBranchPointerDrag}
          >
            <span>{refName}</span>
            {shouldShowDelete ? (
              <button
                className="commit-ref-delete"
                type="button"
                draggable={false}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) =>
                  openBranchDeleteModal(event, refName, commitSha)
                }
              >
                <Trash2 size={11} />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
};

const CommitGraphSvg = ({
  graph,
  graphWidth,
  repoRoot,
  threadOfId,
  gitChangesOfCwd,
  isWorktreeMergedOfPath,
  openCommitMessageModal,
  deleteGitWorktree,
}: {
  graph: CommitGraph;
  graphWidth: number;
  repoRoot: string;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  isWorktreeMergedOfPath: { [path: string]: boolean };
  openCommitMessageModal: (row: CommitGraphRow) => void;
  deleteGitWorktree: (worktree: GitWorktree) => Promise<void>;
}) => {
  const graphHeight = Math.max(
    COMMIT_GRAPH_ROW_HEIGHT,
    graph.rows.length * COMMIT_GRAPH_ROW_HEIGHT,
  );
  const readSegmentY = (rowIndex: number) => {
    if (rowIndex >= graph.rows.length) {
      return graphHeight;
    }

    return readCommitGraphY(rowIndex);
  };

  const openRowThread = async (
    event: MouseEvent<SVGGElement>,
    row: CommitGraphRow,
  ) => {
    event.stopPropagation();
    const thread = readCommitGraphRowThread(row, threadOfId);

    if (thread === null) {
      return;
    }

    await window.molttree.openCodexThread(thread.id);
  };
  const openRowVSCode = async (
    event: MouseEvent<SVGGElement>,
    row: CommitGraphRow,
  ) => {
    event.stopPropagation();
    const thread = readCommitGraphRowThread(row, threadOfId);

    if (thread === null || thread.cwd.length === 0) {
      return;
    }

    await window.molttree.openVSCodePath(thread.cwd);
  };
  const openRowCommitMessageModal = (
    event: MouseEvent<SVGGElement>,
    row: CommitGraphRow,
  ) => {
    event.stopPropagation();
    openCommitMessageModal(row);
  };
  const deleteRowWorktree = async (
    event: MouseEvent<SVGGElement>,
    worktree: GitWorktree,
  ) => {
    event.stopPropagation();
    await deleteGitWorktree(worktree);
  };

  const renderChangeCount = ({
    changeSummary,
    rightX,
    centerY,
    title,
  }: {
    changeSummary: GitChangeSummary["staged"];
    rightX: number;
    centerY: number;
    title: string;
  }) => {
    const addedText = `+${changeSummary.added}`;
    const removedText = `-${changeSummary.removed}`;
    const removedTextWidth = readCommitGraphTextWidth(removedText);

    return (
      <g className="commit-graph-change-count">
        <text
          className="commit-graph-change-added"
          x={rightX - removedTextWidth - COMMIT_GRAPH_CHANGE_TEXT_GAP}
          y={centerY + 3}
          textAnchor="end"
        >
          {addedText}
        </text>
        <text
          className="commit-graph-change-removed"
          x={rightX}
          y={centerY + 3}
          textAnchor="end"
        >
          {removedText}
        </text>
        <title>{title}</title>
      </g>
    );
  };

  return (
    <svg
      className="commit-graph-svg"
      width={graphWidth}
      height={graphHeight}
      viewBox={`0 0 ${graphWidth} ${graphHeight}`}
      aria-hidden="true"
    >
      {graph.segments.map((segment) => {
        const fromX = readCommitGraphX(segment.fromLane);
        const toX = readCommitGraphX(segment.toLane);
        const fromY = readSegmentY(segment.fromRowIndex);
        const toY = readSegmentY(segment.toRowIndex);
        const rowTopConnectionY = Math.min(
          segment.toRowIndex * COMMIT_GRAPH_ROW_HEIGHT +
            COMMIT_GRAPH_ROW_HEIGHT * COMMIT_GRAPH_ROW_CONNECTION_INSET_RATIO,
          toY,
        );
        const color = segment.isGraySegment
          ? COMMIT_GRAPH_GRAY_COLOR
          : readCommitGraphColor(segment.colorIndex);
        const path =
          fromX === toX
            ? `M ${fromX} ${fromY} L ${toX} ${toY}`
            : `M ${fromX} ${fromY} L ${toX} ${rowTopConnectionY} L ${toX} ${toY}`;

        return (
          <path
            key={`${segment.fromRowIndex}-${segment.toRowIndex}-${segment.fromLane}-${segment.toLane}-${segment.colorIndex}-${segment.isMergeSegment}-${segment.isGraySegment}`}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {graph.rows.map((row) => {
        const centerX = readCommitGraphX(row.lane);
        const centerY = readCommitGraphY(row.rowIndex);

        if (row.kind === "commit") {
          return (
            <circle
              key={row.id}
              cx={centerX}
              cy={centerY}
              r={COMMIT_GRAPH_DOT_RADIUS}
              fill={readCommitGraphColor(row.colorIndex)}
            />
          );
        }

        return (
          <g key={row.id}>
            <circle
              cx={centerX}
              cy={centerY}
              r={COMMIT_GRAPH_DOT_RADIUS + 2}
              fill="#ffffff"
            />
            <Bot
              x={centerX - COMMIT_GRAPH_BOT_ICON_SIZE / 2}
              y={centerY - COMMIT_GRAPH_BOT_ICON_SIZE / 2}
              size={COMMIT_GRAPH_BOT_ICON_SIZE}
              color={COMMIT_GRAPH_GRAY_COLOR}
              strokeWidth={2}
            />
          </g>
        );
      })}

      {graph.rows.map((row) => {
        const shouldShowChat = row.threadIds.length > 0;
        const worktree = row.worktree;
        const rowCwd = readCommitGraphRowCwd(row, threadOfId, repoRoot);
        const storedChangeSummary =
          rowCwd === null ? undefined : gitChangesOfCwd[rowCwd];
        const changeSummary = storedChangeSummary ?? EMPTY_GIT_CHANGE_SUMMARY;
        const totalChangeSummary = readTotalGitChangeSummary(changeSummary);
        const shouldShowChangeCount =
          totalChangeSummary.added > 0 || totalChangeSummary.removed > 0;
        const shouldShowTrash =
          row.kind === "worktree" &&
          worktree !== null &&
          worktree.path !== repoRoot &&
          storedChangeSummary !== undefined &&
          readIsGitChangeSummaryEmpty(changeSummary) &&
          isWorktreeMergedOfPath[worktree.path] === true;

        const thread = readCommitGraphRowThread(row, threadOfId);
        const canOpenPath = thread !== null && thread.cwd.length > 0;
        const canOpenCommitMessage = rowCwd !== null;
        const shouldShowCommitAction =
          canOpenCommitMessage && shouldShowChangeCount;

        if (
          !shouldShowChat &&
          !shouldShowTrash &&
          !shouldShowChangeCount &&
          !canOpenPath
        ) {
          return null;
        }

        const centerY = readCommitGraphY(row.rowIndex);
        let nextIconCenterX =
          graphWidth -
          COMMIT_GRAPH_ACTION_RIGHT_PADDING -
          COMMIT_GRAPH_ACTION_HIT_SIZE / 2;
        let trashCenterX: number | null = null;
        let vscodeCenterX: number | null = null;
        let chatCenterX: number | null = null;
        let commitCenterX: number | null = null;

        if (shouldShowTrash) {
          trashCenterX = nextIconCenterX;
          nextIconCenterX -= COMMIT_GRAPH_ACTION_ICON_SPACING;
        }

        if (canOpenPath) {
          vscodeCenterX = nextIconCenterX;
          nextIconCenterX -= COMMIT_GRAPH_ACTION_ICON_SPACING;
        }

        if (shouldShowChat) {
          chatCenterX = nextIconCenterX;
          nextIconCenterX -= COMMIT_GRAPH_ACTION_ICON_SPACING;
        }

        if (shouldShowCommitAction) {
          commitCenterX = nextIconCenterX;
          nextIconCenterX -= COMMIT_GRAPH_ACTION_ICON_SPACING;
        }

        const changeTextRightX =
          nextIconCenterX + COMMIT_GRAPH_ACTION_HIT_SIZE / 2;

        return (
          <g key={`actions-${row.id}`}>
            {shouldShowChangeCount
              ? renderChangeCount({
                  changeSummary: totalChangeSummary,
                  rightX: changeTextRightX,
                  centerY,
                  title: "Total changes",
                })
              : null}
            {commitCenterX === null ? null : (
              <g
                className="commit-graph-action-link"
                onClick={(event) => openRowCommitMessageModal(event, row)}
              >
                <rect
                  className="commit-graph-action-hit-area"
                  x={commitCenterX - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  width={COMMIT_GRAPH_ACTION_HIT_SIZE}
                  height={COMMIT_GRAPH_ACTION_HIT_SIZE}
                />
                <Plus
                  x={commitCenterX - COMMIT_GRAPH_COMMIT_ICON_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_COMMIT_ICON_SIZE / 2}
                  size={COMMIT_GRAPH_COMMIT_ICON_SIZE}
                  color={COMMIT_GRAPH_GRAY_COLOR}
                  strokeWidth={2.5}
                />
              </g>
            )}
            {chatCenterX === null ? null : (
              <g
                className="commit-graph-action-link"
                onClick={(event) => openRowThread(event, row)}
              >
                <rect
                  className="commit-graph-action-hit-area"
                  x={chatCenterX - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  width={COMMIT_GRAPH_ACTION_HIT_SIZE}
                  height={COMMIT_GRAPH_ACTION_HIT_SIZE}
                />
                <MessageSquare
                  x={chatCenterX - COMMIT_GRAPH_CHAT_ICON_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_CHAT_ICON_SIZE / 2}
                  size={COMMIT_GRAPH_CHAT_ICON_SIZE}
                  color={COMMIT_GRAPH_GRAY_COLOR}
                  strokeWidth={2}
                />
              </g>
            )}
            {vscodeCenterX === null ? null : (
              <g
                className="commit-graph-action-link"
                onClick={(event) => openRowVSCode(event, row)}
              >
                <rect
                  className="commit-graph-action-hit-area"
                  x={vscodeCenterX - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  width={COMMIT_GRAPH_ACTION_HIT_SIZE}
                  height={COMMIT_GRAPH_ACTION_HIT_SIZE}
                />
                <ExternalLink
                  x={vscodeCenterX - COMMIT_GRAPH_CODE_ICON_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_CODE_ICON_SIZE / 2}
                  size={COMMIT_GRAPH_CODE_ICON_SIZE}
                  color={COMMIT_GRAPH_GRAY_COLOR}
                  strokeWidth={2}
                />
              </g>
            )}
            {trashCenterX !== null && worktree !== null ? (
              <g
                className="commit-graph-action-link"
                onClick={(event) => deleteRowWorktree(event, worktree)}
              >
                <rect
                  className="commit-graph-action-hit-area"
                  x={trashCenterX - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  width={COMMIT_GRAPH_ACTION_HIT_SIZE}
                  height={COMMIT_GRAPH_ACTION_HIT_SIZE}
                />
                <Trash2
                  x={trashCenterX - COMMIT_GRAPH_TRASH_ICON_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_TRASH_ICON_SIZE / 2}
                  size={COMMIT_GRAPH_TRASH_ICON_SIZE}
                  color={COMMIT_GRAPH_GRAY_COLOR}
                  strokeWidth={2}
                />
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

const CommitHistoryRow = ({
  row,
  repoRoot,
  threadOfId,
  isMergeDragSource,
  isMergeDropTarget,
  isBranchDeleteSafeOfBranch,
  startCommitMergeDrag,
  updateCommitMergeDropTarget,
  clearCommitMergeDropTarget,
  finishCommitMergeDrop,
  finishCommitMergeDrag,
  openBranchDeleteModal,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  row: CommitGraphRow;
  repoRoot: string;
  threadOfId: { [id: string]: CodexThread };
  isMergeDragSource: boolean;
  isMergeDropTarget: boolean;
  isBranchDeleteSafeOfBranch: { [branch: string]: boolean };
  startCommitMergeDrag: (event: DragEvent<HTMLDivElement>) => void;
  updateCommitMergeDropTarget: (event: DragEvent<HTMLDivElement>) => void;
  clearCommitMergeDropTarget: () => void;
  finishCommitMergeDrop: (event: DragEvent<HTMLDivElement>) => void;
  finishCommitMergeDrag: () => void;
  openBranchDeleteModal: (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
    oldSha: string,
  ) => void;
  startBranchPointerDrag: ({
    event,
    branch,
    oldSha,
    oldShortSha,
  }: {
    event: DragEvent<HTMLElement>;
    branch: string;
    oldSha: string;
    oldShortSha: string;
  }) => void;
  finishBranchPointerDrag: () => void;
}) => {
  const { commit } = row;
  const threadId = row.threadIds[0];
  const thread = threadId === undefined ? undefined : threadOfId[threadId];
  const threads = row.threadIds
    .map((rowThreadId) => threadOfId[rowThreadId])
    .filter((rowThread): rowThread is CodexThread => rowThread !== undefined);
  const refs = row.kind === "worktree" ? [] : commit.refs;
  let worktrees: GitWorktree[] = [];
  let subject = commit.subject;
  let subjectTitle = commit.subject;
  let rowClassName = "commit-history-row";

  if (row.kind === "worktree" && row.worktree !== null) {
    worktrees = [row.worktree];
    subject = "";
    subjectTitle = "";
    rowClassName = "commit-history-row commit-history-row-worktree";
  }

  if (row.kind === "head") {
    rowClassName = "commit-history-row commit-history-row-head";
  }

  if (row.kind === "chat") {
    subject = thread === undefined ? "(Chat)" : threadTitle(thread);
    subjectTitle = thread === undefined ? commit.subject : thread.cwd;
    rowClassName = "commit-history-row commit-history-row-chat";
  }

  if (isMergeDragSource) {
    rowClassName = `${rowClassName} commit-history-row-merge-drag-source`;
  }

  if (isMergeDropTarget) {
    rowClassName = `${rowClassName} commit-history-row-merge-drop-target`;
  }

  return (
    <div
      className={rowClassName}
      draggable
      onDragStart={startCommitMergeDrag}
      onDragOver={updateCommitMergeDropTarget}
      onDragLeave={clearCommitMergeDropTarget}
      onDragEnd={finishCommitMergeDrag}
      onDrop={finishCommitMergeDrop}
    >
      <div className="commit-graph-cell" />
      <div className="commit-branch-tags-cell">
        <BranchTags
          refs={refs}
          localBranches={commit.localBranches}
          worktrees={worktrees}
          threads={threads}
          shouldShowHeadTag={row.kind === "head"}
          repoRoot={repoRoot}
          commitSha={commit.sha}
          commitShortSha={commit.shortSha}
          isBranchDeleteSafeOfBranch={isBranchDeleteSafeOfBranch}
          openBranchDeleteModal={openBranchDeleteModal}
          startBranchPointerDrag={startBranchPointerDrag}
          finishBranchPointerDrag={finishBranchPointerDrag}
        />
      </div>
      <div className="commit-description-cell">
        <span className="commit-subject" title={subjectTitle}>
          {subject}
        </span>
      </div>
      <code className="commit-hash-cell">{commit.shortSha}</code>
      <div className="commit-author-cell" title={commit.author}>
        {commit.author}
      </div>
      <div className="commit-date-cell">{formatCommitDate(commit.date)}</div>
    </div>
  );
};

const CommitHistoryColumnResizeHandle = ({
  columnKey,
  startColumnResize,
  updateColumnResize,
  finishColumnResize,
}: {
  columnKey: CommitHistoryColumnKey;
  startColumnResize: ({
    event,
    columnKey,
  }: {
    event: PointerEvent<HTMLButtonElement>;
    columnKey: CommitHistoryColumnKey;
  }) => void;
  updateColumnResize: (event: PointerEvent<HTMLButtonElement>) => void;
  finishColumnResize: (event: PointerEvent<HTMLButtonElement>) => void;
}) => {
  return (
    <button
      className="commit-history-column-resize"
      type="button"
      onPointerDown={(event) => startColumnResize({ event, columnKey })}
      onPointerMove={updateColumnResize}
      onPointerUp={finishColumnResize}
      onPointerCancel={finishColumnResize}
    />
  );
};

const CommitHistory = ({
  commits,
  worktrees,
  threadOfId,
  repoRoot,
  gitChangesOfCwd,
  refreshDashboard,
  showErrorMessage,
  rememberBranchTagChange,
}: {
  commits: GitCommit[];
  worktrees: GitWorktree[];
  threadOfId: { [id: string]: CodexThread };
  repoRoot: string;
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  refreshDashboard: () => Promise<void>;
  showErrorMessage: (message: string) => void;
  rememberBranchTagChange: (branchTagChange: GitBranchTagChange) => void;
}) => {
  const commitHistoryRef = useRef<HTMLDivElement | null>(null);
  const columnResizeRef = useRef<CommitHistoryColumnResize | null>(null);
  const [columnWidths, setColumnWidths] = useState<CommitHistoryColumnWidths>(
    COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS,
  );
  const [shouldShowChatOnly, setShouldShowChatOnly] = useState(false);
  const [commitMergeDrag, setCommitMergeDrag] =
    useState<CommitMergeDrag | null>(null);
  const commitMergeDragRef = useRef<CommitMergeDrag | null>(null);
  const branchPointerDragRef = useRef<BranchPointerDrag | null>(null);
  const commitMergeDragOverLogKeyRef = useRef<string | null>(null);
  const [commitMessageRow, setCommitMessageRow] =
    useState<CommitGraphRow | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchToDelete, setBranchToDelete] =
    useState<BranchDeleteTarget | null>(null);
  const [commitMergeConfirmation, setCommitMergeConfirmation] =
    useState<CommitMergeConfirmation | null>(null);
  const [branchPointerMove, setBranchPointerMove] =
    useState<BranchPointerMove | null>(null);
  const [mergeDropTargetRowId, setMergeDropTargetRowId] = useState<
    string | null
  >(null);
  const [branchPointerDropTargetRowId, setBranchPointerDropTargetRowId] =
    useState<string | null>(null);
  const worktreesOfHead = useMemo(() => {
    const nextWorktreesOfHead: { [sha: string]: GitWorktree[] } = {};

    for (const worktree of worktrees) {
      if (worktree.head === null) {
        continue;
      }

      if (nextWorktreesOfHead[worktree.head] === undefined) {
        nextWorktreesOfHead[worktree.head] = [];
      }

      nextWorktreesOfHead[worktree.head].push(worktree);
    }

    return nextWorktreesOfHead;
  }, [worktrees]);
  const graph = useMemo(
    () => createCommitGraph(commits, worktreesOfHead),
    [commits, worktreesOfHead],
  );
  // Branch delete buttons are only shown when the branch tip would stay visible after removing that branch and its matching origin ref.
  const isBranchDeleteSafeOfBranch = useMemo(() => {
    const commitOfSha: { [sha: string]: GitCommit } = {};
    const branchShaOfBranch: { [branch: string]: string } = {};
    const isBranchCheckedOutOfBranch: { [branch: string]: boolean } = {};
    const rootShas: {
      sha: string;
      ignoredBranchOfBranch: { [branch: string]: boolean };
    }[] = [];

    const pushRootSha = ({
      sha,
      ignoredBranch,
    }: {
      sha: string;
      ignoredBranch: string | null;
    }) => {
      const ignoredBranchOfBranch: { [branch: string]: boolean } = {};

      if (ignoredBranch !== null) {
        ignoredBranchOfBranch[ignoredBranch] = true;
      }

      rootShas.push({ sha, ignoredBranchOfBranch });
    };
    const pushReachableShas = ({
      startSha,
      isReachableSha,
    }: {
      startSha: string;
      isReachableSha: { [sha: string]: boolean };
    }) => {
      const shasToRead = [startSha];

      while (shasToRead.length > 0) {
        const sha = shasToRead.pop();

        if (sha === undefined || isReachableSha[sha] === true) {
          continue;
        }

        isReachableSha[sha] = true;
        const commit = commitOfSha[sha];

        if (commit === undefined) {
          continue;
        }

        for (const parent of commit.parents) {
          shasToRead.push(parent);
        }
      }
    };

    // First collect the local branches and checked-out branches.
    for (const commit of commits) {
      commitOfSha[commit.sha] = commit;

      for (const localBranch of commit.localBranches) {
        branchShaOfBranch[localBranch] = commit.sha;
      }

      for (const ref of commit.refs) {
        if (ref.startsWith("HEAD -> ")) {
          isBranchCheckedOutOfBranch[cleanRefName(ref)] = true;
        }
      }
    }

    for (const worktree of worktrees) {
      if (worktree.branch !== null) {
        isBranchCheckedOutOfBranch[worktree.branch] = true;
      }
    }

    // Then collect the refs that would keep commits visible.
    for (const commit of commits) {
      for (const localBranch of commit.localBranches) {
        pushRootSha({ sha: commit.sha, ignoredBranch: localBranch });
      }

      for (const ref of commit.refs) {
        if (ref.startsWith("HEAD -> ")) {
          continue;
        }

        if (readIsHeadRef(ref)) {
          pushRootSha({ sha: commit.sha, ignoredBranch: null });
          continue;
        }

        if (ref.startsWith("tag: ")) {
          pushRootSha({ sha: commit.sha, ignoredBranch: null });
          continue;
        }

        const refName = cleanRefName(ref);

        if (commit.localBranches.includes(refName)) {
          continue;
        }

        if (refName === "origin/HEAD") {
          const ignoredBranchOfBranch: { [branch: string]: boolean } = {};

          for (const branch of Object.keys(branchShaOfBranch)) {
            if (commit.refs.includes(`origin/${branch}`)) {
              ignoredBranchOfBranch[branch] = true;
            }
          }

          rootShas.push({ sha: commit.sha, ignoredBranchOfBranch });
          continue;
        }

        if (refName.startsWith("origin/")) {
          pushRootSha({
            sha: commit.sha,
            ignoredBranch: refName.slice("origin/".length),
          });
          continue;
        }

        pushRootSha({ sha: commit.sha, ignoredBranch: null });
      }
    }

    for (const worktree of worktrees) {
      if (worktree.head === null) {
        continue;
      }

      pushRootSha({ sha: worktree.head, ignoredBranch: worktree.branch });
    }

    // Finally test each branch as if both the local branch and origin branch were gone.
    const nextIsBranchDeleteSafeOfBranch: { [branch: string]: boolean } = {};

    for (const branch of Object.keys(branchShaOfBranch)) {
      if (isBranchCheckedOutOfBranch[branch] === true) {
        nextIsBranchDeleteSafeOfBranch[branch] = false;
        continue;
      }

      const isReachableSha: { [sha: string]: boolean } = {};

      for (const root of rootShas) {
        if (root.ignoredBranchOfBranch[branch] === true) {
          continue;
        }

        pushReachableShas({
          startSha: root.sha,
          isReachableSha,
        });
      }

      nextIsBranchDeleteSafeOfBranch[branch] =
        isReachableSha[branchShaOfBranch[branch]] === true;
    }

    return nextIsBranchDeleteSafeOfBranch;
  }, [commits, worktrees]);
  const visibleGraph = useMemo(() => {
    if (!shouldShowChatOnly) {
      return graph;
    }

    const rows: CommitGraphRow[] = [];
    const rowIndexOfOldRowIndex: { [rowIndex: number]: number } = {};

    for (const row of graph.rows) {
      if (row.threadIds.length === 0) {
        continue;
      }

      const rowIndex = rows.length;
      rowIndexOfOldRowIndex[row.rowIndex] = rowIndex;
      rows.push({ ...row, rowIndex });
    }

    const segments: CommitGraphSegment[] = [];

    for (const segment of graph.segments) {
      const fromRowIndex = rowIndexOfOldRowIndex[segment.fromRowIndex];
      const toRowIndex = rowIndexOfOldRowIndex[segment.toRowIndex];

      if (fromRowIndex === undefined || toRowIndex === undefined) {
        continue;
      }

      segments.push({ ...segment, fromRowIndex, toRowIndex });
    }

    return {
      rows,
      segments,
      laneCount: graph.laneCount,
    };
  }, [graph, shouldShowChatOnly]);
  const isWorktreeMergedOfPath = useMemo(() => {
    const commitOfSha: { [sha: string]: GitCommit } = {};
    const childShasOfSha: { [sha: string]: string[] } = {};
    const isMergedOfPath: { [path: string]: boolean } = {};

    const isTrackedBranchCommit = ({
      commit,
      worktree,
    }: {
      commit: GitCommit;
      worktree: GitWorktree;
    }) => {
      for (const branch of commit.localBranches) {
        if (branch === worktree.branch) {
          continue;
        }

        return true;
      }

      for (const ref of commit.refs) {
        if (ref === "HEAD" || ref.startsWith("tag: ")) {
          continue;
        }

        if (cleanRefName(ref) === worktree.branch) {
          continue;
        }

        return true;
      }

      return false;
    };

    for (const commit of commits) {
      commitOfSha[commit.sha] = commit;

      for (const parent of commit.parents) {
        if (childShasOfSha[parent] === undefined) {
          childShasOfSha[parent] = [];
        }

        childShasOfSha[parent].push(commit.sha);
      }
    }

    for (const worktree of worktrees) {
      if (worktree.head === null) {
        continue;
      }

      const seenSha: { [sha: string]: boolean } = {};
      const shasToRead = [worktree.head];

      while (shasToRead.length > 0) {
        const sha = shasToRead.pop();

        if (sha === undefined || seenSha[sha] === true) {
          continue;
        }

        seenSha[sha] = true;
        const commit = commitOfSha[sha];

        if (
          commit !== undefined &&
          isTrackedBranchCommit({ commit, worktree })
        ) {
          isMergedOfPath[worktree.path] = true;
          break;
        }

        for (const childSha of childShasOfSha[sha] ?? []) {
          shasToRead.push(childSha);
        }
      }
    }

    return isMergedOfPath;
  }, [commits, worktrees]);
  const graphActionWidth = useMemo(() => {
    let maxActionWidth = 0;

    for (const row of visibleGraph.rows) {
      const actionWidth = readCommitGraphRowActionWidth({
        row,
        repoRoot,
        threadOfId,
        gitChangesOfCwd,
        isWorktreeMergedOfPath,
      });
      maxActionWidth = Math.max(maxActionWidth, actionWidth);
    }

    return maxActionWidth;
  }, [
    visibleGraph,
    repoRoot,
    threadOfId,
    gitChangesOfCwd,
    isWorktreeMergedOfPath,
  ]);
  const graphMinimumWidth = readCommitGraphWidth({
    laneCount: visibleGraph.laneCount,
    actionWidth: graphActionWidth,
  });
  const visibleColumnWidths: CommitHistoryColumnWidths = {
    ...columnWidths,
    graph: Math.max(columnWidths.graph, graphMinimumWidth),
  };
  const graphWidth = visibleColumnWidths.graph;
  const gridTemplateColumns =
    readCommitGridTemplateColumns(visibleColumnWidths);
  const tableWidth = readCommitHistoryTableWidth(visibleColumnWidths);

  useLayoutEffect(() => {
    if (commitHistoryRef.current === null) {
      return;
    }

    commitHistoryRef.current.style.setProperty(
      "--commit-history-grid-template-columns",
      gridTemplateColumns,
    );
    commitHistoryRef.current.style.setProperty(
      "--commit-history-table-width",
      `${tableWidth}px`,
    );
  }, [gridTemplateColumns, tableWidth]);

  const readColumnMinWidth = (columnKey: CommitHistoryColumnKey) => {
    if (columnKey === "graph") {
      return graphMinimumWidth;
    }

    return COMMIT_HISTORY_MIN_COLUMN_WIDTHS[columnKey];
  };
  const startColumnResize = ({
    event,
    columnKey,
  }: {
    event: PointerEvent<HTMLButtonElement>;
    columnKey: CommitHistoryColumnKey;
  }) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    columnResizeRef.current = {
      columnKey,
      startClientX: event.clientX,
      startColumnWidths: visibleColumnWidths,
      startWidth: visibleColumnWidths[columnKey],
      currentWidth: visibleColumnWidths[columnKey],
    };
  };
  const updateColumnResize = (event: PointerEvent<HTMLButtonElement>) => {
    const columnResize = columnResizeRef.current;

    if (columnResize === null || commitHistoryRef.current === null) {
      return;
    }

    const minWidth = readColumnMinWidth(columnResize.columnKey);
    const nextWidth = Math.max(
      minWidth,
      columnResize.startWidth + event.clientX - columnResize.startClientX,
    );
    const nextColumnWidths = replaceCommitHistoryColumnWidth({
      columnWidths: columnResize.startColumnWidths,
      columnKey: columnResize.columnKey,
      width: nextWidth,
    });
    columnResizeRef.current = {
      ...columnResize,
      currentWidth: nextWidth,
    };
    updateCommitHistoryColumnStyles(commitHistoryRef.current, nextColumnWidths);
  };
  const finishColumnResize = (event: PointerEvent<HTMLButtonElement>) => {
    const columnResize = columnResizeRef.current;

    if (columnResize === null) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setColumnWidths(
      replaceCommitHistoryColumnWidth({
        columnWidths: columnResize.startColumnWidths,
        columnKey: columnResize.columnKey,
        width: columnResize.currentWidth,
      }),
    );
    columnResizeRef.current = null;
  };
  const startBranchPointerDrag = ({
    event,
    branch,
    oldSha,
    oldShortSha,
  }: {
    event: DragEvent<HTMLElement>;
    branch: string;
    oldSha: string;
    oldShortSha: string;
  }) => {
    const nextBranchPointerDrag = {
      repoRoot,
      branch,
      oldSha,
      oldShortSha,
    };

    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", branch);
    branchPointerDragRef.current = nextBranchPointerDrag;
    setBranchPointerDropTargetRowId(null);
  };
  const finishBranchPointerDrag = () => {
    branchPointerDragRef.current = null;
    setBranchPointerDropTargetRowId(null);
  };
  const startCommitMergeDrag = ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    const rowCwd = readCommitGraphRowCwd(row, threadOfId, repoRoot);
    const changeSummary = rowCwd === null ? undefined : gitChangesOfCwd[rowCwd];

    if (
      changeSummary !== undefined &&
      !readIsGitChangeSummaryEmpty(changeSummary)
    ) {
      event.preventDefault();
      showErrorMessage("You must commit this to merge it.");
      logCommitMerge("drag start blocked: row has changes", {
        rowId: row.id,
        rowKind: row.kind,
        rowSha: row.commit.sha,
        rowCwd,
      });
      return;
    }

    const nextCommitMergeDrag = {
      rowId: row.id,
      repoRoot,
      sha: row.commit.sha,
      shortSha: row.commit.shortSha,
    };

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.commit.shortSha);
    commitMergeDragRef.current = nextCommitMergeDrag;
    commitMergeDragOverLogKeyRef.current = null;
    setCommitMergeDrag(nextCommitMergeDrag);
    logCommitMerge("drag start", {
      drag: nextCommitMergeDrag,
      rowId: row.id,
      rowKind: row.kind,
      rowSha: row.commit.sha,
      rowRefs: row.commit.refs,
      rowLocalBranches: row.commit.localBranches,
      rowThreadIds: row.threadIds,
      rowWorktreePath: row.worktree?.path,
    });
  };
  const updateCommitMergeDropTarget = ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    const activeBranchPointerDrag = branchPointerDragRef.current;

    if (activeBranchPointerDrag !== null) {
      if (
        activeBranchPointerDrag.repoRoot !== repoRoot ||
        activeBranchPointerDrag.oldSha === row.commit.sha
      ) {
        setBranchPointerDropTargetRowId(null);
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setBranchPointerDropTargetRowId(row.id);
      setMergeDropTargetRowId(null);
      return;
    }

    const activeCommitMergeDrag = commitMergeDragRef.current;

    if (activeCommitMergeDrag === null) {
      const logKey = `no-active-drag:${row.id}`;

      if (commitMergeDragOverLogKeyRef.current !== logKey) {
        commitMergeDragOverLogKeyRef.current = logKey;
        logCommitMerge("drag over blocked: no active drag", {
          rowId: row.id,
          rowKind: row.kind,
          rowSha: row.commit.sha,
        });
      }

      return;
    }

    if (activeCommitMergeDrag.repoRoot !== repoRoot) {
      const logKey = `different-repo:${row.id}`;

      if (commitMergeDragOverLogKeyRef.current !== logKey) {
        commitMergeDragOverLogKeyRef.current = logKey;
        logCommitMerge("drag over blocked: different repo", {
          drag: activeCommitMergeDrag,
          repoRoot,
          rowId: row.id,
          rowKind: row.kind,
          rowSha: row.commit.sha,
        });
      }

      return;
    }

    if (activeCommitMergeDrag.sha === row.commit.sha) {
      const logKey = `same-sha:${row.id}`;

      if (commitMergeDragOverLogKeyRef.current !== logKey) {
        commitMergeDragOverLogKeyRef.current = logKey;
        logCommitMerge("drag over blocked: same sha", {
          drag: activeCommitMergeDrag,
          rowId: row.id,
          rowKind: row.kind,
          rowSha: row.commit.sha,
        });
      }

      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setMergeDropTargetRowId(row.id);
    const logKey = `accepted:${row.id}`;

    if (commitMergeDragOverLogKeyRef.current !== logKey) {
      commitMergeDragOverLogKeyRef.current = logKey;
      logCommitMerge("drag over accepted", {
        drag: activeCommitMergeDrag,
        rowId: row.id,
        rowKind: row.kind,
        rowSha: row.commit.sha,
        rowRefs: row.commit.refs,
        rowLocalBranches: row.commit.localBranches,
        rowThreadIds: row.threadIds,
        rowWorktreePath: row.worktree?.path,
      });
    }
  };
  const clearCommitMergeDropTarget = () => {
    setMergeDropTargetRowId(null);
    setBranchPointerDropTargetRowId(null);
  };
  const finishCommitMergeDrag = () => {
    commitMergeDragRef.current = null;
    commitMergeDragOverLogKeyRef.current = null;
    setCommitMergeDrag(null);
    setMergeDropTargetRowId(null);
    logCommitMerge("drag finished", {});
  };
  const readCommitMergeTargetForBranch = (localBranch: string) => {
    for (const worktree of worktrees) {
      if (worktree.branch !== localBranch) {
        continue;
      }

      const target: CommitMergeTarget = {
        targetBranch: null,
        targetWorktreePath: worktree.path,
      };

      return target;
    }

    const target: CommitMergeTarget = {
      targetBranch: localBranch,
      targetWorktreePath: null,
    };

    return target;
  };
  const readCommitMergeTarget = (row: CommitGraphRow) => {
    const localBranches = Array.isArray(row.commit.localBranches)
      ? row.commit.localBranches
      : [];

    if (row.kind === "worktree" && row.worktree !== null) {
      const target: CommitMergeTarget = {
        targetBranch: null,
        targetWorktreePath: row.worktree.path,
      };

      logCommitMerge("target resolved from worktree row", {
        rowId: row.id,
        rowSha: row.commit.sha,
        target,
      });

      return target;
    }

    if (row.kind === "chat") {
      const threadId = row.threadIds[0];
      const thread = threadId === undefined ? undefined : threadOfId[threadId];

      if (thread === undefined || thread.cwd.length === 0) {
        throw new Error("Drop target chat has no working directory.");
      }

      const target: CommitMergeTarget = {
        targetBranch: null,
        targetWorktreePath: thread.cwd,
      };

      logCommitMerge("target resolved from chat row", {
        rowId: row.id,
        rowSha: row.commit.sha,
        threadId,
        target,
      });

      return target;
    }

    for (const ref of row.commit.refs) {
      const cleanedRef = cleanRefName(ref);

      for (const localBranch of localBranches) {
        if (cleanedRef !== localBranch) {
          continue;
        }

        const target = readCommitMergeTargetForBranch(localBranch);
        logCommitMerge("target resolved from matching ref", {
          rowId: row.id,
          rowSha: row.commit.sha,
          ref,
          localBranch,
          target,
        });

        return target;
      }
    }

    const localBranch = localBranches[0];

    if (localBranch === undefined) {
      throw new Error(
        "Did nothing. To merge this, drop it onto a branch or a worktree.",
      );
    }

    const target = readCommitMergeTargetForBranch(localBranch);
    logCommitMerge("target resolved from first local branch", {
      rowId: row.id,
      rowSha: row.commit.sha,
      localBranch,
      target,
    });

    return target;
  };
  const finishCommitMergeDrop = async ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    event.preventDefault();
    const activeBranchPointerDrag = branchPointerDragRef.current;

    if (activeBranchPointerDrag !== null) {
      if (
        activeBranchPointerDrag.repoRoot !== repoRoot ||
        activeBranchPointerDrag.oldSha === row.commit.sha
      ) {
        finishBranchPointerDrag();
        return;
      }

      setBranchPointerMove({
        repoRoot,
        branch: activeBranchPointerDrag.branch,
        oldSha: activeBranchPointerDrag.oldSha,
        oldShortSha: activeBranchPointerDrag.oldShortSha,
        newSha: row.commit.sha,
        newShortSha: row.commit.shortSha,
      });
      finishBranchPointerDrag();
      return;
    }

    const activeCommitMergeDrag = commitMergeDragRef.current;
    logCommitMerge("drop started", {
      drag: activeCommitMergeDrag,
      rowId: row.id,
      rowKind: row.kind,
      rowSha: row.commit.sha,
      rowRefs: row.commit.refs,
      rowLocalBranches: row.commit.localBranches,
      rowThreadIds: row.threadIds,
      rowWorktreePath: row.worktree?.path,
    });

    if (activeCommitMergeDrag === null) {
      logCommitMerge("drop stopped: no active drag", { rowId: row.id });
      finishCommitMergeDrag();
      return;
    }

    if (activeCommitMergeDrag.repoRoot !== repoRoot) {
      logCommitMerge("drop stopped: different repo", {
        drag: activeCommitMergeDrag,
        repoRoot,
        rowId: row.id,
      });
      finishCommitMergeDrag();
      return;
    }

    if (activeCommitMergeDrag.sha === row.commit.sha) {
      logCommitMerge("drop stopped: same sha", {
        drag: activeCommitMergeDrag,
        rowId: row.id,
      });
      finishCommitMergeDrag();
      return;
    }

    let gitMergeRequest: GitMergeRequest;

    try {
      const target = readCommitMergeTarget(row);
      gitMergeRequest = {
        repoRoot,
        fromSha: activeCommitMergeDrag.sha,
        toSha: row.commit.sha,
        targetBranch: target.targetBranch,
        targetWorktreePath: target.targetWorktreePath,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to read merge target.";
      logCommitMerge("drop stopped: target read failed", {
        message,
        rowId: row.id,
        rowKind: row.kind,
        rowSha: row.commit.sha,
      });
      showErrorMessage(message);
      finishCommitMergeDrag();
      return;
    }

    setCommitMergeConfirmation({
      gitMergeRequest,
      fromShortSha: activeCommitMergeDrag.shortSha,
      toShortSha: row.commit.shortSha,
    });
    finishCommitMergeDrag();
  };
  const openCommitMessageModal = (row: CommitGraphRow) => {
    setCommitMessageRow(row);
    setCommitMessage("");
  };
  const closeCommitMessageModal = () => {
    setCommitMessageRow(null);
    setCommitMessage("");
  };
  const submitCommitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (commitMessageRow === null) {
      return;
    }

    const path = readCommitGraphRowCwd(commitMessageRow, threadOfId, repoRoot);

    if (path === null) {
      showErrorMessage("No working directory found for this row.");
      return;
    }

    try {
      await window.molttree.commitAllGitChanges({
        path,
        message: commitMessage.trim(),
      });
      closeCommitMessageModal();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to commit changes.";
      showErrorMessage(message);
    } finally {
      await refreshDashboard();
    }
  };
  const deleteGitWorktree = async (worktree: GitWorktree) => {
    try {
      await window.molttree.deleteGitWorktree({
        repoRoot,
        path: worktree.path,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete worktree.";
      showErrorMessage(message);
    } finally {
      await refreshDashboard();
    }
  };
  const openBranchDeleteModal = (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
    oldSha: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setBranchToDelete({ branch, oldSha });
  };
  const closeBranchDeleteModal = () => {
    setBranchToDelete(null);
  };
  const closeCommitMergeConfirmationModal = () => {
    setCommitMergeConfirmation(null);
  };
  const closeBranchPointerMoveModal = () => {
    setBranchPointerMove(null);
  };
  const deleteBranchTag = async () => {
    if (branchToDelete === null) {
      return;
    }

    const branchDeleteTarget = branchToDelete;
    closeBranchDeleteModal();

    try {
      await window.molttree.deleteGitBranch({
        repoRoot,
        branch: branchDeleteTarget.branch,
      });
      rememberBranchTagChange({
        repoRoot,
        branch: branchDeleteTarget.branch,
        oldSha: branchDeleteTarget.oldSha,
        newSha: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete branch.";
      showErrorMessage(message);
    } finally {
      await refreshDashboard();
    }
  };
  const confirmCommitMerge = async () => {
    if (commitMergeConfirmation === null) {
      return;
    }

    const { gitMergeRequest } = commitMergeConfirmation;
    closeCommitMergeConfirmationModal();
    logCommitMerge("calling startGitMerge", gitMergeRequest);
    let mergeErrorMessage: string | null = null;

    try {
      await window.molttree.startGitMerge(gitMergeRequest);
      logCommitMerge("startGitMerge finished", gitMergeRequest);
    } catch (error) {
      mergeErrorMessage =
        error instanceof Error ? error.message : "Failed to start merge.";
      logCommitMerge("startGitMerge failed", {
        message: mergeErrorMessage,
        gitMergeRequest,
      });
    } finally {
      await refreshDashboard();

      if (mergeErrorMessage !== null) {
        showErrorMessage(mergeErrorMessage);
      }
    }
  };
  const moveBranchPointer = async () => {
    if (branchPointerMove === null) {
      return;
    }

    const request = branchPointerMove;
    closeBranchPointerMoveModal();

    try {
      await window.molttree.moveGitBranch({
        repoRoot: request.repoRoot,
        branch: request.branch,
        oldSha: request.oldSha,
        newSha: request.newSha,
      });
      rememberBranchTagChange({
        repoRoot: request.repoRoot,
        branch: request.branch,
        oldSha: request.oldSha,
        newSha: request.newSha,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to move branch.";
      showErrorMessage(message);
    } finally {
      await refreshDashboard();
    }
  };

  return (
    <>
      <label className="commit-history-filter">
        <input
          type="checkbox"
          checked={shouldShowChatOnly}
          onChange={(event) => setShouldShowChatOnly(event.target.checked)}
        />
        Show chats only
      </label>
      <div className="commit-history" ref={commitHistoryRef}>
        <div className="commit-history-header">
          <div className="commit-history-header-cell commit-history-graph-title">
            <span>Graph</span>
            <CommitHistoryColumnResizeHandle
              columnKey="graph"
              startColumnResize={startColumnResize}
              updateColumnResize={updateColumnResize}
              finishColumnResize={finishColumnResize}
            />
          </div>
          <div className="commit-history-header-cell">
            <span>Branch Tags</span>
            <CommitHistoryColumnResizeHandle
              columnKey="branchTags"
              startColumnResize={startColumnResize}
              updateColumnResize={updateColumnResize}
              finishColumnResize={finishColumnResize}
            />
          </div>
          <div className="commit-history-header-cell">
            <span>Description</span>
            <CommitHistoryColumnResizeHandle
              columnKey="description"
              startColumnResize={startColumnResize}
              updateColumnResize={updateColumnResize}
              finishColumnResize={finishColumnResize}
            />
          </div>
          <div className="commit-history-header-cell">
            <span>Commit</span>
            <CommitHistoryColumnResizeHandle
              columnKey="commit"
              startColumnResize={startColumnResize}
              updateColumnResize={updateColumnResize}
              finishColumnResize={finishColumnResize}
            />
          </div>
          <div className="commit-history-header-cell">
            <span>Author</span>
            <CommitHistoryColumnResizeHandle
              columnKey="author"
              startColumnResize={startColumnResize}
              updateColumnResize={updateColumnResize}
              finishColumnResize={finishColumnResize}
            />
          </div>
          <div className="commit-history-header-cell">
            <span>Date</span>
            <CommitHistoryColumnResizeHandle
              columnKey="date"
              startColumnResize={startColumnResize}
              updateColumnResize={updateColumnResize}
              finishColumnResize={finishColumnResize}
            />
          </div>
        </div>
        <div className="commit-history-body">
          <CommitGraphSvg
            graph={visibleGraph}
            graphWidth={graphWidth}
            repoRoot={repoRoot}
            threadOfId={threadOfId}
            gitChangesOfCwd={gitChangesOfCwd}
            isWorktreeMergedOfPath={isWorktreeMergedOfPath}
            openCommitMessageModal={openCommitMessageModal}
            deleteGitWorktree={deleteGitWorktree}
          />
          {visibleGraph.rows.map((row) => (
            <CommitHistoryRow
              key={row.id}
              row={row}
              repoRoot={repoRoot}
              threadOfId={threadOfId}
              isMergeDragSource={commitMergeDrag?.rowId === row.id}
              isMergeDropTarget={
                mergeDropTargetRowId === row.id ||
                branchPointerDropTargetRowId === row.id
              }
              isBranchDeleteSafeOfBranch={isBranchDeleteSafeOfBranch}
              startCommitMergeDrag={(event) =>
                startCommitMergeDrag({ event, row })
              }
              updateCommitMergeDropTarget={(event) =>
                updateCommitMergeDropTarget({ event, row })
              }
              clearCommitMergeDropTarget={clearCommitMergeDropTarget}
              finishCommitMergeDrop={(event) =>
                finishCommitMergeDrop({ event, row })
              }
              finishCommitMergeDrag={finishCommitMergeDrag}
              openBranchDeleteModal={openBranchDeleteModal}
              startBranchPointerDrag={startBranchPointerDrag}
              finishBranchPointerDrag={finishBranchPointerDrag}
            />
          ))}
        </div>
        {commitMessageRow === null ? null : (
          <div className="commit-message-modal-backdrop">
            <form
              className="commit-message-modal"
              onSubmit={submitCommitMessage}
            >
              <h3>Commit Message</h3>
              <input
                autoFocus
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
              />
              <div className="commit-message-modal-actions">
                <button type="button" onClick={closeCommitMessageModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={commitMessage.trim().length === 0}
                >
                  Commit
                </button>
              </div>
            </form>
          </div>
        )}
        {branchToDelete === null ? null : (
          <div className="commit-message-modal-backdrop">
            <div className="commit-message-modal">
              <h3>Delete Branch Tag</h3>
              <p className="branch-delete-modal-message">
                Are you sure you want to delete the {branchToDelete.branch} tag?
              </p>
              <div className="commit-message-modal-actions">
                <button type="button" onClick={closeBranchDeleteModal}>
                  Cancel
                </button>
                <button type="button" onClick={deleteBranchTag}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
        {commitMergeConfirmation === null ? null : (
          <div className="commit-message-modal-backdrop">
            <div className="commit-message-modal">
              <h3>Merge Branches</h3>
              <p className="branch-delete-modal-message">
                Are you sure you want to merge{" "}
                {commitMergeConfirmation.fromShortSha} into{" "}
                {commitMergeConfirmation.toShortSha} and switch to it?
              </p>
              <div className="commit-message-modal-actions">
                <button
                  type="button"
                  onClick={closeCommitMergeConfirmationModal}
                >
                  Cancel
                </button>
                <button type="button" onClick={confirmCommitMerge}>
                  Merge
                </button>
              </div>
            </div>
          </div>
        )}
        {branchPointerMove === null ? null : (
          <div className="commit-message-modal-backdrop">
            <div className="commit-message-modal">
              <h3>Move Branch Pointer</h3>
              <p className="branch-delete-modal-message">
                Are you sure you want to make the {branchPointerMove.branch}{" "}
                branch point to {branchPointerMove.newShortSha} instead of{" "}
                {branchPointerMove.oldShortSha}?
              </p>
              <div className="commit-message-modal-actions">
                <button type="button" onClick={closeBranchPointerMoveModal}>
                  Cancel
                </button>
                <button type="button" onClick={moveBranchPointer}>
                  Move
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

const RepoSection = ({
  repo,
  threadOfId,
  gitChangesOfCwd,
  repoBranchTagChanges,
  refreshDashboard,
  showErrorMessage,
  rememberBranchTagChange,
  openBranchTagChangeModal,
}: {
  repo: RepoGraph;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  repoBranchTagChanges: GitBranchTagChange[];
  refreshDashboard: () => Promise<void>;
  showErrorMessage: (message: string) => void;
  rememberBranchTagChange: (branchTagChange: GitBranchTagChange) => void;
  openBranchTagChangeModal: (
    action: BranchTagChangeAction,
    repoRoot: string,
  ) => void;
}) => {
  const repoFolderName = repo.root.split("/").pop() ?? repo.root;

  return (
    <section className="repo-section">
      <div className="repo-header">
        <div className="repo-title">{repoFolderName}</div>
        <div className="repo-actions">
          <button
            className="icon-button"
            title="Undo branch tag changes for this repo"
            onClick={() => openBranchTagChangeModal("reset", repo.root)}
            disabled={repoBranchTagChanges.length === 0}
          >
            <span className="branch-action-icon">
              <GitBranch size={18} />
              <Undo2 className="branch-action-icon-mark" size={10} />
            </span>
          </button>
          <button
            className="icon-button"
            title="Push branch tag changes for this repo"
            onClick={() => openBranchTagChangeModal("push", repo.root)}
            disabled={repoBranchTagChanges.length === 0}
          >
            <span className="branch-action-icon">
              <GitBranch size={18} />
              <Upload className="branch-action-icon-mark" size={10} />
            </span>
          </button>
        </div>
      </div>

      <div className="repo-panel">
        <CommitHistory
          commits={repo.commits}
          worktrees={repo.worktrees}
          threadOfId={threadOfId}
          repoRoot={repo.root}
          gitChangesOfCwd={gitChangesOfCwd}
          refreshDashboard={refreshDashboard}
          showErrorMessage={showErrorMessage}
          rememberBranchTagChange={rememberBranchTagChange}
        />
      </div>
    </section>
  );
};

const ThreadList = ({ threads }: { threads: CodexThread[] }) => {
  return (
    <aside className="sidebar">
      <h2>Codex threads</h2>
      <div className="sidebar-list">
        {threads.slice(0, 80).map((thread) => (
          <button
            className="sidebar-thread"
            key={thread.id}
            onClick={() => window.molttree.openCodexThread(thread.id)}
          >
            <span>{threadTitle(thread)}</span>
            <small>{thread.gitInfo?.branch ?? thread.cwd}</small>
            <small>{formatDate(thread.updatedAt)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
};

export const App = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [branchTagChanges, setBranchTagChanges] = useState<
    GitBranchTagChange[]
  >([]);
  const [branchTagChangeConfirmation, setBranchTagChangeConfirmation] =
    useState<BranchTagChangeConfirmation | null>(null);
  const isDashboardRefreshRunningRef = useRef(false);

  const threadOfId = useMemo(() => {
    if (dashboardData === null) {
      return {};
    }

    return createThreadOfId(dashboardData.threads);
  }, [dashboardData]);

  const refreshDashboard = useCallback(async () => {
    if (isDashboardRefreshRunningRef.current) {
      return;
    }

    isDashboardRefreshRunningRef.current = true;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextDashboardData = await window.molttree.readDashboard();
      setDashboardData(nextDashboardData);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to read dashboard data.";
      setSuccessMessage(null);
      setErrorMessage(message);
    } finally {
      isDashboardRefreshRunningRef.current = false;
      setIsLoading(false);
    }
  }, []);
  const showErrorMessage = useCallback((message: string) => {
    setSuccessMessage(null);
    setErrorMessage(message);
  }, []);
  const rememberBranchTagChange = useCallback(
    (nextBranchTagChange: GitBranchTagChange) => {
      setBranchTagChanges((currentBranchTagChanges) => {
        const nextBranchTagChanges: GitBranchTagChange[] = [];
        let didReplaceBranchTagChange = false;

        for (const branchTagChange of currentBranchTagChanges) {
          if (
            branchTagChange.repoRoot !== nextBranchTagChange.repoRoot ||
            branchTagChange.branch !== nextBranchTagChange.branch
          ) {
            nextBranchTagChanges.push(branchTagChange);
            continue;
          }

          didReplaceBranchTagChange = true;

          if (branchTagChange.oldSha !== nextBranchTagChange.newSha) {
            nextBranchTagChanges.push({
              ...nextBranchTagChange,
              oldSha: branchTagChange.oldSha,
            });
          }
        }

        if (
          !didReplaceBranchTagChange &&
          nextBranchTagChange.oldSha !== nextBranchTagChange.newSha
        ) {
          nextBranchTagChanges.push(nextBranchTagChange);
        }

        return nextBranchTagChanges;
      });
    },
    [],
  );

  useEffect(() => {
    void refreshDashboard();

    const dashboardRefreshIntervalId = window.setInterval(() => {
      void refreshDashboard();
    }, DASHBOARD_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(dashboardRefreshIntervalId);
    };
  }, [refreshDashboard]);

  useEffect(() => {
    if (successMessage === null) {
      return;
    }

    const successMessageTimeoutId = window.setTimeout(() => {
      setSuccessMessage(null);
    }, SUCCESS_MESSAGE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(successMessageTimeoutId);
    };
  }, [successMessage]);

  const readVisibleBranchTagChangesForRepo = (repoRoot: string) => {
    const repo =
      dashboardData === null
        ? undefined
        : dashboardData.repos.find(
            (dashboardRepo) => dashboardRepo.root === repoRoot,
          );
    const repoBranchTagChanges =
      repo === undefined ? [] : repo.branchTagChanges;

    return readBranchTagChangesForRepo({
      branchTagChanges,
      repoBranchTagChanges,
      repoRoot,
    });
  };
  const openBranchTagChangeModal = (
    action: BranchTagChangeAction,
    repoRoot: string,
  ) => {
    const repoBranchTagChanges = readVisibleBranchTagChangesForRepo(repoRoot);

    if (repoBranchTagChanges.length === 0) {
      return;
    }

    setBranchTagChangeConfirmation({ action, repoRoot });
  };
  const closeBranchTagChangeModal = () => {
    setBranchTagChangeConfirmation(null);
  };
  const confirmBranchTagChanges = async () => {
    if (branchTagChangeConfirmation === null) {
      return;
    }

    const { action, repoRoot } = branchTagChangeConfirmation;
    const changes = readVisibleBranchTagChangesForRepo(repoRoot);

    if (changes.length === 0) {
      closeBranchTagChangeModal();
      return;
    }

    closeBranchTagChangeModal();

    try {
      if (action === "push") {
        await window.molttree.pushGitBranchTagChanges(changes);
      } else {
        await window.molttree.resetGitBranchTagChanges(changes);
      }

      setBranchTagChanges((currentBranchTagChanges) =>
        currentBranchTagChanges.filter(
          (branchTagChange) => branchTagChange.repoRoot !== repoRoot,
        ),
      );
      setSuccessMessage(
        action === "push"
          ? "Branch tag changes pushed."
          : "Branch tag changes reset.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to apply branch tag changes.";
      showErrorMessage(message);
    } finally {
      await refreshDashboard();
    }
  };
  const branchTagChangesInConfirmation =
    branchTagChangeConfirmation === null
      ? []
      : readVisibleBranchTagChangesForRepo(
          branchTagChangeConfirmation.repoRoot,
        );

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>Molt Tree</h1>
          <p>
            {dashboardData === null
              ? "Loading"
              : `${dashboardData.repos.length} repos · ${dashboardData.threads.length} threads`}
          </p>
        </div>
        <div className="toolbar">
          <button
            className="icon-button"
            title="Refresh Git and Codex data"
            onClick={refreshDashboard}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {branchTagChangeConfirmation === null ? null : (
        <div className="commit-message-modal-backdrop">
          <div className="commit-message-modal branch-tag-change-modal">
            <h3>
              {branchTagChangeConfirmation.action === "push"
                ? "Push Branch Tag Changes"
                : "Reset Branch Tag Changes"}
            </h3>
            <p className="branch-delete-modal-message">
              {branchTagChangeConfirmation.action === "push"
                ? "Are you sure you want to push branch tag changes for this repo?"
                : "Are you sure you want to reset branch tag changes for this repo to match origin?"}
            </p>
            <ul className="branch-tag-change-list">
              {branchTagChangesInConfirmation.map((branchTagChange) => (
                <li
                  key={`${branchTagChange.repoRoot}:${branchTagChange.branch}`}
                >
                  <strong>{branchTagChange.branch}</strong>
                  <span>{branchTagChange.repoRoot}</span>
                  <code>
                    {branchTagChange.newSha === null
                      ? `${branchTagChange.oldSha.slice(0, 7)} -> deleted`
                      : `${branchTagChange.oldSha.slice(0, 7)} -> ${branchTagChange.newSha.slice(0, 7)}`}
                  </code>
                </li>
              ))}
            </ul>
            <div className="commit-message-modal-actions">
              <button type="button" onClick={closeBranchTagChangeModal}>
                Cancel
              </button>
              <button type="button" onClick={confirmBranchTagChanges}>
                {branchTagChangeConfirmation.action === "push"
                  ? "Push"
                  : "Reset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMessage !== null && (
        <div className="error-banner">{errorMessage}</div>
      )}

      {successMessage !== null && (
        <div className="success-banner">{successMessage}</div>
      )}

      {dashboardData !== null && dashboardData.warnings.length > 0 && (
        <div className="warning-band">
          {dashboardData.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}

      <div className="content-shell">
        <ThreadList threads={dashboardData?.threads ?? []} />
        <div className="repo-list">
          {dashboardData?.repos.map((repo) => (
            <RepoSection
              key={repo.key}
              repo={repo}
              threadOfId={threadOfId}
              gitChangesOfCwd={dashboardData.gitChangesOfCwd}
              repoBranchTagChanges={readVisibleBranchTagChangesForRepo(
                repo.root,
              )}
              refreshDashboard={refreshDashboard}
              showErrorMessage={showErrorMessage}
              rememberBranchTagChange={rememberBranchTagChange}
              openBranchTagChangeModal={openBranchTagChangeModal}
            />
          ))}
          {dashboardData !== null &&
            dashboardData.repos.length === 0 &&
            !isLoading && (
              <div className="empty-state">
                <GitCommitHorizontal size={22} />
                <span>
                  No Git repos found from Codex thread working directories.
                </span>
              </div>
            )}
        </div>
      </div>
    </main>
  );
};
