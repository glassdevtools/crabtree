import {
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  MessageSquarePlus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type {
  CodexThread,
  DashboardData,
  GitCommit,
  GitWorktree,
  RepoGraph,
} from "../shared/types";

// The history view is a SourceTree-style row table. Git owns the commits; the renderer only assigns lanes.
// TODO: AI-PICKED-VALUE: These graph sizes and colors are initial SourceTree-like choices for dense commit rows.
const COMMIT_GRAPH_ROW_HEIGHT = 40;
const COMMIT_GRAPH_LANE_WIDTH = 22;
const COMMIT_GRAPH_PADDING_LEFT = 18;
const COMMIT_GRAPH_MIN_WIDTH = 178;
const COMMIT_GRAPH_DOT_RADIUS = 6;
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
  commit: GitCommit;
  lane: number;
  colorIndex: number;
  rowIndex: number;
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

const createCommitGraph = (commits: GitCommit[]) => {
  const colorIndexOfSha: { [sha: string]: number } = {};
  const lanes: CommitGraphLane[] = [];
  const rows: CommitGraphRow[] = [];
  const segments: CommitGraphSegment[] = [];
  const isSegmentAddedOfKey: { [key: string]: boolean } = {};
  let nextColorIndex = 0;
  let laneCount = 1;

  const addSegment = ({
    fromLane,
    toLane,
    fromRowIndex,
    toRowIndex,
    colorIndex,
    isMergeSegment,
  }: CommitGraphSegment) => {
    const key = `${fromLane}:${toLane}:${fromRowIndex}:${toRowIndex}:${colorIndex}:${isMergeSegment}`;

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
    });
  };

  for (const commit of commits) {
    let lane = lanes.findIndex((laneItem) => laneItem.sha === commit.sha);

    if (lane === -1) {
      let colorIndex = colorIndexOfSha[commit.sha];

      if (colorIndex === undefined) {
        colorIndex = nextColorIndex;
        colorIndexOfSha[commit.sha] = colorIndex;
        nextColorIndex += 1;
      }

      lane = lanes.length;
      lanes[lane] = { sha: commit.sha, colorIndex };
    }

    const commitLane = lanes[lane];
    const rowIndex = rows.length;
    rows.push({ commit, lane, colorIndex: commitLane.colorIndex, rowIndex });
    colorIndexOfSha[commit.sha] = commitLane.colorIndex;
    laneCount = Math.max(laneCount, lanes.length, lane + 1);

    const nextLanes = [...lanes];
    nextLanes.splice(lane, 1);
    const parentLanes: CommitGraphLane[] = [];

    for (
      let parentIndex = 0;
      parentIndex < commit.parents.length;
      parentIndex += 1
    ) {
      const parent = commit.parents[parentIndex];
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
        if (parentIndex === 0) {
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
      });
    }

    for (
      let parentIndex = 0;
      parentIndex < commit.parents.length;
      parentIndex += 1
    ) {
      const parent = commit.parents[parentIndex];
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
  threadIds,
  threadOfId,
}: {
  refs: string[];
  threadIds: string[];
  threadOfId: { [id: string]: CodexThread };
}) => {
  if (refs.length === 0 && threadIds.length === 0) {
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
        const color = readCommitGraphColor(segment.colorIndex);
        const path =
          fromX === toX
            ? `M ${fromX} ${fromY} L ${toX} ${toY}`
            : `M ${fromX} ${fromY} L ${toX} ${rowTopConnectionY} L ${toX} ${toY}`;

        return (
          <path
            key={`${segment.fromRowIndex}-${segment.toRowIndex}-${segment.fromLane}-${segment.toLane}-${segment.colorIndex}-${segment.isMergeSegment}`}
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
          key={row.commit.sha}
          cx={readCommitGraphX(row.lane)}
          cy={readCommitGraphY(row.rowIndex)}
          r={COMMIT_GRAPH_DOT_RADIUS}
          fill={readCommitGraphColor(row.colorIndex)}
          stroke="#ffffff"
          strokeWidth="2"
        />
      ))}
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
  const shouldOpenThread = commit.threadIds.length > 0;
  const rowClassName = shouldOpenThread
    ? "commit-history-row commit-history-row-clickable"
    : "commit-history-row";

  const openCommitThread = async () => {
    const threadId = commit.threadIds[0];

    if (threadId === undefined) {
      return;
    }

    await window.molttree.openCodexThread(threadId);
  };

  const openCommitThreadFromKey = async (
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    await openCommitThread();
  };

  return (
    <div
      className={rowClassName}
      style={{ gridTemplateColumns }}
      role={shouldOpenThread ? "button" : undefined}
      tabIndex={shouldOpenThread ? 0 : undefined}
      onClick={shouldOpenThread ? openCommitThread : undefined}
      onKeyDown={shouldOpenThread ? openCommitThreadFromKey : undefined}
    >
      <div className="commit-graph-cell" />
      <div className="commit-message-cell">
        <div className="commit-message-line">
          <CommitLabels
            refs={commit.refs}
            threadIds={commit.threadIds}
            threadOfId={threadOfId}
          />
          <span className="commit-subject" title={commit.subject}>
            {commit.subject}
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
  threadOfId,
}: {
  commits: GitCommit[];
  threadOfId: { [id: string]: CodexThread };
}) => {
  const graph = useMemo(() => createCommitGraph(commits), [commits]);
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
            key={row.commit.sha}
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
        <CommitHistory commits={repo.commits} threadOfId={threadOfId} />
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
