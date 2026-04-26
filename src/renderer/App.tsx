import {
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import type {
  CodexThread,
  DashboardData,
  GitCommit,
  GitWorktree,
  RepoGraph,
} from "../shared/types";

// The history view is a SourceTree-style row table. Git owns the commits; the renderer only assigns lanes.
// TODO: AI-PICKED-VALUE: These graph sizes and colors are initial SourceTree-like choices for dense commit rows.
const COMMIT_GRAPH_ROW_HEIGHT = 32;
const COMMIT_GRAPH_LANE_WIDTH = 22;
const COMMIT_GRAPH_PADDING_LEFT = 18;
const COMMIT_GRAPH_MIN_WIDTH = 178;
const COMMIT_GRAPH_DOT_RADIUS = 6;
const COMMIT_GRAPH_WORKTREE_COLOR = "#8b929c";
const COMMIT_GRAPH_CHAT_ICON_SIZE = 14;
const COMMIT_GRAPH_MARKER_SLOT_WIDTH = 18;
const COMMIT_GRAPH_ROW_CONNECTION_INSET_RATIO = 0;
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

type CommitGraphRow = {
  id: string;
  commit: GitCommit;
  worktree: GitWorktree | null;
  threadIds: string[];
  lane: number;
  colorIndex: number;
  rowIndex: number;
};

type CommitGraphItem = {
  id: string;
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
  isWorktreeSegment: boolean;
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

const readCommitGridTemplateColumns = (graphWidth: number) => {
  return `${graphWidth}px minmax(340px, 1fr) 104px 180px 210px`;
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
    const shouldWorktreeOwnChat = worktrees.some(
      (worktree) => worktree.threadIds.length > 0,
    );

    for (const worktree of worktrees) {
      graphItems.push({
        id: `worktree:${worktree.path}:${commit.sha}`,
        commit,
        worktree,
        sha: `worktree:${worktree.path}:${commit.sha}`,
        parents: [commit.sha],
        threadIds: worktree.threadIds,
      });
    }

    graphItems.push({
      id: `commit:${commit.sha}`,
      commit,
      worktree: null,
      sha: commit.sha,
      parents: commit.parents,
      threadIds: shouldWorktreeOwnChat ? [] : commit.threadIds,
    });
  }

  const addSegment = ({
    fromLane,
    toLane,
    fromRowIndex,
    toRowIndex,
    colorIndex,
    isMergeSegment,
    isWorktreeSegment,
  }: CommitGraphSegment) => {
    const key = `${fromLane}:${toLane}:${fromRowIndex}:${toRowIndex}:${colorIndex}:${isMergeSegment}:${isWorktreeSegment}`;

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
      isWorktreeSegment,
    });
  };

  // Worktrees are added to the same row list before lane assignment, so they render like normal branch heads.
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
        if (graphItem.worktree !== null) {
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
        isWorktreeSegment: false,
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
        isWorktreeSegment: graphItem.worktree !== null,
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

const ThreadPill = ({ thread }: { thread: CodexThread }) => {
  const openThread = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await window.molttree.openCodexThread(thread.id);
  };

  return (
    <button className="thread-pill" title={thread.id} onClick={openThread}>
      <span>{threadTitle(thread)}</span>
      <ExternalLink size={13} />
    </button>
  );
};

const CommitLabels = ({
  refs,
  worktrees,
  threadIds,
  threadOfId,
}: {
  refs: string[];
  worktrees: GitWorktree[];
  threadIds: string[];
  threadOfId: { [id: string]: CodexThread };
}) => {
  if (refs.length === 0 && worktrees.length === 0 && threadIds.length === 0) {
    return null;
  }

  return (
    <div className="commit-label-list">
      {refs.map((ref) => (
        <span className="commit-ref" title={ref} key={ref}>
          <GitBranch size={13} />
          <span>{cleanRefName(ref)}</span>
        </span>
      ))}
      {worktrees.map((worktree) => {
        const pathParts = worktree.path.split("/");
        const pathName = pathParts[pathParts.length - 1] ?? worktree.path;

        return (
          <span
            className="commit-worktree"
            title={worktree.path}
            key={worktree.path}
          >
            <FolderGit2 size={13} />
            <span>{worktree.branch ?? pathName}</span>
          </span>
        );
      })}
      {threadIds.map((threadId) => {
        const thread = threadOfId[threadId];

        if (thread === undefined) {
          return null;
        }

        return <ThreadPill key={thread.id} thread={thread} />;
      })}
    </div>
  );
};

const CommitGraphSvg = ({
  graph,
  graphWidth,
}: {
  graph: CommitGraph;
  graphWidth: number;
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
    const threadId = row.threadIds[0];

    if (threadId === undefined) {
      return;
    }

    await window.molttree.openCodexThread(threadId);
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
        const color = segment.isWorktreeSegment
          ? COMMIT_GRAPH_WORKTREE_COLOR
          : readCommitGraphColor(segment.colorIndex);
        const path =
          fromX === toX
            ? `M ${fromX} ${fromY} L ${toX} ${toY}`
            : `M ${fromX} ${fromY} L ${toX} ${rowTopConnectionY} L ${toX} ${toY}`;

        return (
          <path
            key={`${segment.fromRowIndex}-${segment.toRowIndex}-${segment.fromLane}-${segment.toLane}-${segment.colorIndex}-${segment.isMergeSegment}-${segment.isWorktreeSegment}`}
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
            row.worktree === null
              ? readCommitGraphColor(row.colorIndex)
              : COMMIT_GRAPH_WORKTREE_COLOR
          }
        />
      ))}

      {graph.rows.map((row) => {
        const shouldShowChat = row.threadIds.length > 0;

        if (!shouldShowChat) {
          return null;
        }

        const centerY = readCommitGraphY(row.rowIndex);
        const chatCenterX =
          graphWidth -
          COMMIT_GRAPH_PADDING_LEFT -
          COMMIT_GRAPH_MARKER_SLOT_WIDTH;

        return (
          <g
            className="commit-graph-chat-link"
            key={`chat-${row.id}`}
            onClick={(event) => openRowThread(event, row)}
          >
            <MessageSquare
              x={chatCenterX - COMMIT_GRAPH_CHAT_ICON_SIZE / 2}
              y={centerY - COMMIT_GRAPH_CHAT_ICON_SIZE / 2}
              size={COMMIT_GRAPH_CHAT_ICON_SIZE}
              color={COMMIT_GRAPH_WORKTREE_COLOR}
              strokeWidth={2}
            />
          </g>
        );
      })}
    </svg>
  );
};

const CommitHistoryRow = ({
  row,
  threadOfId,
  gridTemplateColumns,
}: {
  row: CommitGraphRow;
  threadOfId: { [id: string]: CodexThread };
  gridTemplateColumns: string;
}) => {
  const { commit } = row;
  const refs = row.worktree === null ? commit.refs : [];
  const worktrees = row.worktree === null ? [] : [row.worktree];
  const subject = row.worktree === null ? commit.subject : row.worktree.path;
  const rowClassName =
    row.worktree === null
      ? "commit-history-row"
      : "commit-history-row commit-history-row-worktree";

  return (
    <div className={rowClassName} style={{ gridTemplateColumns }}>
      <div className="commit-graph-cell" />
      <div className="commit-message-cell">
        <div className="commit-message-line">
          <CommitLabels
            refs={refs}
            worktrees={worktrees}
            threadIds={row.threadIds}
            threadOfId={threadOfId}
          />
          <span className="commit-subject" title={subject}>
            {subject}
          </span>
        </div>
      </div>
      <code className="commit-hash-cell">{commit.shortSha}</code>
      <div className="commit-author-cell" title={commit.author}>
        {commit.author}
      </div>
      <div className="commit-date-cell">{formatCommitDate(commit.date)}</div>
    </div>
  );
};

const CommitHistory = ({
  commits,
  worktrees,
  threadOfId,
}: {
  commits: GitCommit[];
  worktrees: GitWorktree[];
  threadOfId: { [id: string]: CodexThread };
}) => {
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
  const graphWidth = readCommitGraphWidth(graph.laneCount);
  const gridTemplateColumns = readCommitGridTemplateColumns(graphWidth);

  return (
    <div className="commit-history">
      <div className="commit-history-header" style={{ gridTemplateColumns }}>
        <span>Graph</span>
        <span>Description</span>
        <span>Commit</span>
        <span>Author</span>
        <span>Date</span>
      </div>
      <div className="commit-history-body">
        <CommitGraphSvg graph={graph} graphWidth={graphWidth} />
        {graph.rows.map((row) => (
          <CommitHistoryRow
            key={row.id}
            row={row}
            threadOfId={threadOfId}
            gridTemplateColumns={gridTemplateColumns}
          />
        ))}
      </div>
    </div>
  );
};

const WorktreeRow = ({
  worktree,
  threadOfId,
}: {
  worktree: GitWorktree;
  threadOfId: { [id: string]: CodexThread };
}) => {
  return (
    <div className="worktree-row">
      <div className="worktree-main">
        <FolderGit2 size={16} />
        <div>
          <div className="worktree-path">{worktree.path}</div>
          <div className="meta-line">
            {worktree.branch ?? "detached"}{" "}
            {worktree.head === null ? "" : `at ${worktree.head.slice(0, 7)}`}
          </div>
        </div>
      </div>
      <div className="thread-strip">
        {worktree.threadIds.map((threadId) => {
          const thread = threadOfId[threadId];

          if (thread === undefined) {
            return null;
          }

          return <ThreadPill key={thread.id} thread={thread} />;
        })}
      </div>
    </div>
  );
};

const RepoSection = ({
  repo,
  threadOfId,
}: {
  repo: RepoGraph;
  threadOfId: { [id: string]: CodexThread };
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

      <div className="repo-worktrees">
        <div className="repo-panel">
          <h2>Worktrees</h2>
          <div className="row-list">
            {repo.worktrees.map((worktree) => (
              <WorktreeRow
                key={worktree.path}
                worktree={worktree}
                threadOfId={threadOfId}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="repo-panel">
        <h2>History</h2>
        <CommitHistory
          commits={repo.commits}
          worktrees={repo.worktrees}
          threadOfId={threadOfId}
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

  const threadOfId = useMemo(() => {
    if (dashboardData === null) {
      return {};
    }

    return createThreadOfId(dashboardData.threads);
  }, [dashboardData]);

  const refreshDashboard = async () => {
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
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshDashboard();
  }, []);

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
          {isLoading && (
            <div className="loading-line">Loading Codex and Git data</div>
          )}
          {dashboardData?.repos.map((repo) => (
            <RepoSection key={repo.key} repo={repo} threadOfId={threadOfId} />
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
