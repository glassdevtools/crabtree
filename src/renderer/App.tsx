import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Code,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";
import type {
  CodexThread,
  DashboardData,
  GitChangeSummary,
  GitCommit,
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
const COMMIT_GRAPH_CHANGE_ICON_SIZE = 12;
const COMMIT_GRAPH_COMMIT_ICON_SIZE = 12;
const COMMIT_GRAPH_ACTION_HIT_SIZE = 14;
const COMMIT_GRAPH_MARKER_SLOT_WIDTH = 18;
const COMMIT_GRAPH_CHANGE_TEXT_WIDTH = 46;
const COMMIT_GRAPH_ROW_CONNECTION_INSET_RATIO = 0;
// Dashboard reads touch Codex and Git, so automatic refreshes are spaced out and share the manual refresh path.
// TODO: AI-PICKED-VALUE: Refreshing every 15 seconds keeps graph data current without constantly running Git commands.
const DASHBOARD_REFRESH_INTERVAL_MS = 15000;
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
};

type CommitGraphRowKind = "commit" | "worktree" | "chat";

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

const readCommitGraphX = (lane: number) => {
  return COMMIT_GRAPH_PADDING_LEFT + lane * COMMIT_GRAPH_LANE_WIDTH;
};

const readCommitGraphY = (rowIndex: number) => {
  return rowIndex * COMMIT_GRAPH_ROW_HEIGHT + COMMIT_GRAPH_ROW_HEIGHT / 2;
};

const readCommitGraphWidth = (laneCount: number) => {
  return Math.max(
    COMMIT_GRAPH_MIN_WIDTH,
    COMMIT_GRAPH_PADDING_LEFT * 2 + laneCount * COMMIT_GRAPH_LANE_WIDTH,
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
  let nextColorIndex = 0;
  let laneCount = 1;

  for (const commit of commits) {
    const worktrees = worktreesOfHead[commit.sha] ?? [];
    const isOwnedByWorktreeOfThreadId: { [threadId: string]: boolean } = {};

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
        colorIndex = nextColorIndex;
        colorIndexOfSha[graphItem.sha] = colorIndex;
        nextColorIndex += 1;
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
        if (graphItem.kind !== "commit") {
          parentColorIndex = nextColorIndex;
          nextColorIndex += 1;
        } else if (parentIndex === 0) {
          parentColorIndex = commitLane.colorIndex;
        } else {
          parentColorIndex = nextColorIndex;
          nextColorIndex += 1;
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
        isGraySegment: graphItem.kind !== "commit",
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
  worktrees,
  repoRoot,
}: {
  refs: string[];
  worktrees: GitWorktree[];
  repoRoot: string;
}) => {
  if (refs.length === 0 && worktrees.length === 0) {
    return null;
  }

  const readWorktreeTagText = (path: string) => {
    if (path === repoRoot) {
      return "HEAD";
    }

    const pathParts = path.split("/");
    const worktreesIndex = pathParts.length - 3;
    const hash = pathParts[worktreesIndex + 1];
    const projectName = pathParts[worktreesIndex + 2];

    if (
      pathParts[worktreesIndex] === "worktrees" &&
      hash !== undefined &&
      hash.length > 0 &&
      projectName !== undefined &&
      projectName.length > 0
    ) {
      return `worktrees/${hash}`;
    }

    return `Worktree at ${path}`;
  };

  return (
    <div className="commit-label-list">
      {refs.map((ref) => (
        <span className="commit-ref" title={ref} key={ref}>
          <GitBranch size={13} />
          <span>{cleanRefName(ref)}</span>
        </span>
      ))}
      {worktrees.map((worktree) => (
        <span
          className="commit-worktree"
          title={worktree.path}
          key={worktree.path}
        >
          <FolderGit2 size={13} />
          <span>{readWorktreeTagText(worktree.path)}</span>
        </span>
      ))}
    </div>
  );
};

const CommitGraphSvg = ({
  graph,
  graphWidth,
  threadOfId,
  gitChangesOfCwd,
  refreshDashboard,
}: {
  graph: CommitGraph;
  graphWidth: number;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  refreshDashboard: () => Promise<void>;
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

  const readRowThread = (row: CommitGraphRow) => {
    const threadId = row.threadIds[0];

    if (threadId === undefined) {
      return null;
    }

    return threadOfId[threadId] ?? null;
  };

  const openRowThread = async (
    event: MouseEvent<SVGGElement>,
    row: CommitGraphRow,
  ) => {
    event.stopPropagation();
    const thread = readRowThread(row);

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
    const thread = readRowThread(row);

    if (thread === null || thread.cwd.length === 0) {
      return;
    }

    await window.molttree.openVSCodePath(thread.cwd);
  };
  const stageRowChanges = async (
    event: MouseEvent<SVGGElement>,
    row: CommitGraphRow,
  ) => {
    event.stopPropagation();
    const thread = readRowThread(row);

    if (thread === null || thread.cwd.length === 0) {
      return;
    }

    await window.molttree.stageGitChanges(thread.cwd);
    await refreshDashboard();
  };
  const unstageRowChanges = async (
    event: MouseEvent<SVGGElement>,
    row: CommitGraphRow,
  ) => {
    event.stopPropagation();
    const thread = readRowThread(row);

    if (thread === null || thread.cwd.length === 0) {
      return;
    }

    await window.molttree.unstageGitChanges(thread.cwd);
    await refreshDashboard();
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
    return (
      <g className="commit-graph-change-count">
        <text
          className="commit-graph-change-added"
          x={rightX - 22}
          y={centerY + 3}
          textAnchor="end"
        >
          +{changeSummary.added}
        </text>
        <text
          className="commit-graph-change-removed"
          x={rightX}
          y={centerY + 3}
          textAnchor="end"
        >
          -{changeSummary.removed}
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

      {graph.rows.map((row) => (
        <circle
          key={row.id}
          cx={readCommitGraphX(row.lane)}
          cy={readCommitGraphY(row.rowIndex)}
          r={COMMIT_GRAPH_DOT_RADIUS}
          fill={
            row.kind === "commit"
              ? readCommitGraphColor(row.colorIndex)
              : COMMIT_GRAPH_GRAY_COLOR
          }
        />
      ))}

      {graph.rows.map((row) => {
        const shouldShowChat = row.threadIds.length > 0;

        if (!shouldShowChat) {
          return null;
        }

        const thread = readRowThread(row);
        const canOpenPath = thread !== null && thread.cwd.length > 0;
        const changeSummary = canOpenPath
          ? (gitChangesOfCwd[thread.cwd] ?? EMPTY_GIT_CHANGE_SUMMARY)
          : EMPTY_GIT_CHANGE_SUMMARY;
        const centerY = readCommitGraphY(row.rowIndex);
        const botCenterX =
          graphWidth -
          COMMIT_GRAPH_PADDING_LEFT -
          COMMIT_GRAPH_MARKER_SLOT_WIDTH * 3;
        const commitCenterX =
          graphWidth -
          COMMIT_GRAPH_PADDING_LEFT -
          COMMIT_GRAPH_MARKER_SLOT_WIDTH * 4;
        const unstagedTextRightX =
          commitCenterX - COMMIT_GRAPH_MARKER_SLOT_WIDTH;
        const unstageCenterX =
          unstagedTextRightX - COMMIT_GRAPH_CHANGE_TEXT_WIDTH;
        const stageCenterX = unstageCenterX - COMMIT_GRAPH_MARKER_SLOT_WIDTH;
        const stagedTextRightX = stageCenterX - COMMIT_GRAPH_MARKER_SLOT_WIDTH;
        const chatCenterX =
          graphWidth -
          COMMIT_GRAPH_PADDING_LEFT -
          COMMIT_GRAPH_MARKER_SLOT_WIDTH * 2;
        const vscodeCenterX =
          graphWidth -
          COMMIT_GRAPH_PADDING_LEFT -
          COMMIT_GRAPH_MARKER_SLOT_WIDTH;

        return (
          <g key={`actions-${row.id}`}>
            {renderChangeCount({
              changeSummary: changeSummary.staged,
              rightX: stagedTextRightX,
              centerY,
              title: "Staged changes",
            })}
            {canOpenPath ? (
              <g
                className="commit-graph-action-link"
                onClick={(event) => stageRowChanges(event, row)}
              >
                <rect
                  className="commit-graph-action-hit-area"
                  x={stageCenterX - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  width={COMMIT_GRAPH_ACTION_HIT_SIZE}
                  height={COMMIT_GRAPH_ACTION_HIT_SIZE}
                />
                <ArrowLeft
                  x={stageCenterX - COMMIT_GRAPH_CHANGE_ICON_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_CHANGE_ICON_SIZE / 2}
                  size={COMMIT_GRAPH_CHANGE_ICON_SIZE}
                  color={COMMIT_GRAPH_GRAY_COLOR}
                  strokeWidth={2.5}
                />
              </g>
            ) : null}
            {canOpenPath ? (
              <g
                className="commit-graph-action-link"
                onClick={(event) => unstageRowChanges(event, row)}
              >
                <rect
                  className="commit-graph-action-hit-area"
                  x={unstageCenterX - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_ACTION_HIT_SIZE / 2}
                  width={COMMIT_GRAPH_ACTION_HIT_SIZE}
                  height={COMMIT_GRAPH_ACTION_HIT_SIZE}
                />
                <ArrowRight
                  x={unstageCenterX - COMMIT_GRAPH_CHANGE_ICON_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_CHANGE_ICON_SIZE / 2}
                  size={COMMIT_GRAPH_CHANGE_ICON_SIZE}
                  color={COMMIT_GRAPH_GRAY_COLOR}
                  strokeWidth={2.5}
                />
              </g>
            ) : null}
            {renderChangeCount({
              changeSummary: changeSummary.unstaged,
              rightX: unstagedTextRightX,
              centerY,
              title: "Unstaged changes",
            })}
            <Plus
              className="commit-graph-action-muted"
              x={commitCenterX - COMMIT_GRAPH_COMMIT_ICON_SIZE / 2}
              y={centerY - COMMIT_GRAPH_COMMIT_ICON_SIZE / 2}
              size={COMMIT_GRAPH_COMMIT_ICON_SIZE}
              color={COMMIT_GRAPH_GRAY_COLOR}
              strokeWidth={2.5}
            />
            <Bot
              x={botCenterX - COMMIT_GRAPH_BOT_ICON_SIZE / 2}
              y={centerY - COMMIT_GRAPH_BOT_ICON_SIZE / 2}
              size={COMMIT_GRAPH_BOT_ICON_SIZE}
              color={COMMIT_GRAPH_GRAY_COLOR}
              strokeWidth={2}
            />
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
            {canOpenPath ? (
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
                <Code
                  x={vscodeCenterX - COMMIT_GRAPH_CODE_ICON_SIZE / 2}
                  y={centerY - COMMIT_GRAPH_CODE_ICON_SIZE / 2}
                  size={COMMIT_GRAPH_CODE_ICON_SIZE}
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
  startCommitMergeDrag,
  updateCommitMergeDropTarget,
  clearCommitMergeDropTarget,
  finishCommitMergeDrop,
  finishCommitMergeDrag,
}: {
  row: CommitGraphRow;
  repoRoot: string;
  threadOfId: { [id: string]: CodexThread };
  isMergeDragSource: boolean;
  isMergeDropTarget: boolean;
  startCommitMergeDrag: (event: DragEvent<HTMLDivElement>) => void;
  updateCommitMergeDropTarget: (event: DragEvent<HTMLDivElement>) => void;
  clearCommitMergeDropTarget: () => void;
  finishCommitMergeDrop: (event: DragEvent<HTMLDivElement>) => void;
  finishCommitMergeDrag: () => void;
}) => {
  const { commit } = row;
  const threadId = row.threadIds[0];
  const thread = threadId === undefined ? undefined : threadOfId[threadId];
  const refs = row.kind === "commit" ? commit.refs : [];
  let worktrees: GitWorktree[] = [];
  let subject = commit.subject;
  let subjectTitle = commit.subject;
  let rowClassName = "commit-history-row";

  if (row.kind === "worktree" && row.worktree !== null) {
    worktrees = [row.worktree];
    subject = "(Worktree)";
    subjectTitle = row.worktree.path;
    rowClassName = "commit-history-row commit-history-row-worktree";
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
        <BranchTags refs={refs} worktrees={worktrees} repoRoot={repoRoot} />
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
}: {
  commits: GitCommit[];
  worktrees: GitWorktree[];
  threadOfId: { [id: string]: CodexThread };
  repoRoot: string;
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  refreshDashboard: () => Promise<void>;
  showErrorMessage: (message: string) => void;
}) => {
  const commitHistoryRef = useRef<HTMLDivElement | null>(null);
  const columnResizeRef = useRef<CommitHistoryColumnResize | null>(null);
  const [columnWidths, setColumnWidths] = useState<CommitHistoryColumnWidths>(
    COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS,
  );
  const [shouldShowChatOnly, setShouldShowChatOnly] = useState(false);
  const [commitMergeDrag, setCommitMergeDrag] =
    useState<CommitMergeDrag | null>(null);
  const [mergeDropTargetRowId, setMergeDropTargetRowId] = useState<
    string | null
  >(null);
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
  const graphMinimumWidth = readCommitGraphWidth(visibleGraph.laneCount);
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
  const startCommitMergeDrag = ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.commit.shortSha);
    setCommitMergeDrag({ rowId: row.id, repoRoot, sha: row.commit.sha });
  };
  const updateCommitMergeDropTarget = ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    if (
      commitMergeDrag === null ||
      commitMergeDrag.repoRoot !== repoRoot ||
      commitMergeDrag.sha === row.commit.sha
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setMergeDropTargetRowId(row.id);
  };
  const clearCommitMergeDropTarget = () => {
    setMergeDropTargetRowId(null);
  };
  const finishCommitMergeDrag = () => {
    setCommitMergeDrag(null);
    setMergeDropTargetRowId(null);
  };
  const finishCommitMergeDrop = async ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    event.preventDefault();

    if (
      commitMergeDrag === null ||
      commitMergeDrag.repoRoot !== repoRoot ||
      commitMergeDrag.sha === row.commit.sha
    ) {
      finishCommitMergeDrag();
      return;
    }

    const gitMergeRequest = {
      repoRoot,
      fromSha: commitMergeDrag.sha,
      toSha: row.commit.sha,
    };
    finishCommitMergeDrag();

    try {
      await window.molttree.startGitMerge(gitMergeRequest);
      await refreshDashboard();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start merge.";
      showErrorMessage(message);
    }
  };

  return (
    <div className="commit-history" ref={commitHistoryRef}>
      <div className="commit-history-header">
        <div className="commit-history-header-cell commit-history-graph-title">
          <label className="commit-history-graph-filter">
            Graph
            <input
              type="checkbox"
              checked={shouldShowChatOnly}
              onChange={(event) => setShouldShowChatOnly(event.target.checked)}
            />
            Chat only
          </label>
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
          threadOfId={threadOfId}
          gitChangesOfCwd={gitChangesOfCwd}
          refreshDashboard={refreshDashboard}
        />
        {visibleGraph.rows.map((row) => (
          <CommitHistoryRow
            key={row.id}
            row={row}
            repoRoot={repoRoot}
            threadOfId={threadOfId}
            isMergeDragSource={commitMergeDrag?.rowId === row.id}
            isMergeDropTarget={mergeDropTargetRowId === row.id}
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
          />
        ))}
      </div>
    </div>
  );
};

const RepoSection = ({
  repo,
  threadOfId,
  gitChangesOfCwd,
  refreshDashboard,
  showErrorMessage,
}: {
  repo: RepoGraph;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  refreshDashboard: () => Promise<void>;
  showErrorMessage: (message: string) => void;
}) => {
  const repoThreads = repo.threadIds
    .map((threadId) => threadOfId[threadId])
    .filter((thread): thread is CodexThread => thread !== undefined);

  return (
    <section className="repo-section">
      <div className="repo-header">
        <div>
          <div className="repo-title">{repo.originUrl ?? repo.root}</div>
          <div className="meta-line">{repo.root}</div>
        </div>
        <div className="repo-stats">
          <span>
            <GitBranch size={15} />
            {repo.currentBranch ?? "detached"}
          </span>
          <span>
            <MessageSquarePlus size={15} />
            {repoThreads.length}
          </span>
        </div>
      </div>

      <div className="repo-panel">
        <h2>History</h2>
        <CommitHistory
          commits={repo.commits}
          worktrees={repo.worktrees}
          threadOfId={threadOfId}
          repoRoot={repo.root}
          gitChangesOfCwd={gitChangesOfCwd}
          refreshDashboard={refreshDashboard}
          showErrorMessage={showErrorMessage}
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
      setErrorMessage(message);
    } finally {
      isDashboardRefreshRunningRef.current = false;
      setIsLoading(false);
    }
  }, []);
  const showErrorMessage = useCallback((message: string) => {
    setErrorMessage(message);
  }, []);

  useEffect(() => {
    void refreshDashboard();

    const dashboardRefreshIntervalId = window.setInterval(() => {
      void refreshDashboard();
    }, DASHBOARD_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(dashboardRefreshIntervalId);
    };
  }, [refreshDashboard]);

  const openNewThread = async () => {
    await window.molttree.openNewCodexThread();
  };

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
            title="Refresh"
            onClick={refreshDashboard}
            disabled={isLoading}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="icon-button"
            title="New Codex thread"
            onClick={openNewThread}
          >
            <MessageSquarePlus size={18} />
          </button>
        </div>
      </header>

      {errorMessage !== null && (
        <div className="error-banner">{errorMessage}</div>
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
              refreshDashboard={refreshDashboard}
              showErrorMessage={showErrorMessage}
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
