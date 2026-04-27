import {
  Bot,
  Check,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitPullRequestArrow,
  RefreshCw,
  Trash2,
  Undo2,
  Upload,
  User,
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
  GitMergePreview,
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
// TODO: AI-PICKED-VALUE: The HEAD icon is small enough to sit beside dense graph lanes without taking over the row.
const COMMIT_GRAPH_USER_ICON_SIZE = 14;
// TODO: AI-PICKED-VALUE: This keeps the HEAD icon aligned with the right edge of the graph column.
const COMMIT_GRAPH_USER_ICON_RIGHT_PADDING = 10;
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

const syncBranchTagChangesWithDashboardData = ({
  branchTagChanges,
  dashboardData,
}: {
  branchTagChanges: GitBranchTagChange[];
  dashboardData: DashboardData;
}) => {
  const branchTagChangeOfBranchOfRepo: {
    [repoRoot: string]: { [branch: string]: GitBranchTagChange };
  } = {};
  const nextBranchTagChanges: GitBranchTagChange[] = [];

  // The dashboard data is the current local branch state compared to origin, so use it as the in-memory baseline after each refresh.
  for (const repo of dashboardData.repos) {
    const branchTagChangeOfBranch: {
      [branch: string]: GitBranchTagChange;
    } = {};
    branchTagChangeOfBranchOfRepo[repo.root] = branchTagChangeOfBranch;

    for (const branchTagChange of repo.branchTagChanges) {
      branchTagChangeOfBranch[branchTagChange.branch] = branchTagChange;
      nextBranchTagChanges.push(branchTagChange);
    }
  }

  // Keep explicit branch choices that the dashboard cannot report, like local deletes and local-only branch moves.
  for (const branchTagChange of branchTagChanges) {
    const branchTagChangeOfBranch =
      branchTagChangeOfBranchOfRepo[branchTagChange.repoRoot];

    if (branchTagChangeOfBranch === undefined) {
      nextBranchTagChanges.push(branchTagChange);
      continue;
    }

    if (branchTagChangeOfBranch[branchTagChange.branch] !== undefined) {
      continue;
    }

    nextBranchTagChanges.push(branchTagChange);
  }

  return nextBranchTagChanges;
};

// TODO: AI-PICKED-VALUE: These column widths match the current table layout closely enough while making drag resizing concrete.
const COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS = {
  graph: 300,
  branchTags: 340,
  actors: 260,
  description: 420,
  commit: 84,
  author: 150,
  date: 170,
};
const COMMIT_HISTORY_MIN_COLUMN_WIDTHS = {
  graph: 300,
  branchTags: 220,
  actors: 120,
  description: 180,
  commit: 64,
  author: 90,
  date: 120,
};

type CommitHistoryColumnKey =
  | "graph"
  | "branchTags"
  | "actors"
  | "description"
  | "commit"
  | "author"
  | "date";

type CommitHistoryColumnWidths = {
  graph: number;
  branchTags: number;
  actors: number;
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

type BranchCreateTarget = {
  path: string;
  title: string;
};

type CommitBranchTarget = {
  branch: string;
  oldSha: string;
};

type CommitMessageTarget = {
  path: string;
  title: string;
  branchTarget: CommitBranchTarget | null;
};

type ChangeSummaryTarget = {
  path: string;
  title: string;
  changeSummary: GitChangeSummary;
};

type BranchMergeConfirmation = {
  branch: string;
  preview: GitMergePreview;
};

type BranchTagChangeAction = "push" | "reset";

type BranchTagChangeConfirmation = {
  action: BranchTagChangeAction;
  repoRoot: string;
};

type CommitGraphRow = {
  id: string;
  commit: GitCommit;
  threadIds: string[];
  lane: number;
  colorIndex: number;
  rowIndex: number;
};

type CommitGraphItem = {
  id: string;
  commit: GitCommit;
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

const readIsThreadActive = (thread: CodexThread) => {
  return thread.status.type === "active";
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

const readCommitGraphWidth = ({ laneCount }: { laneCount: number }) => {
  return Math.max(
    COMMIT_GRAPH_MIN_WIDTH,
    COMMIT_GRAPH_PADDING_LEFT * 2 + laneCount * COMMIT_GRAPH_LANE_WIDTH,
  );
};

const readCommitGridTemplateColumns = (
  columnWidths: CommitHistoryColumnWidths,
) => {
  return `${columnWidths.graph}px ${columnWidths.actors}px ${columnWidths.branchTags}px ${columnWidths.description}px ${columnWidths.commit}px ${columnWidths.author}px ${columnWidths.date}px`;
};

const readCommitHistoryTableWidth = (
  columnWidths: CommitHistoryColumnWidths,
) => {
  return (
    columnWidths.graph +
    columnWidths.branchTags +
    columnWidths.actors +
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
    case "actors":
      return { ...columnWidths, actors: width };
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

const createCommitGraph = (commits: GitCommit[]) => {
  const graphItems: CommitGraphItem[] = [];
  const commitOfSha: { [sha: string]: GitCommit } = {};
  const colorIndexOfSha: { [sha: string]: number } = {};
  const lanes: CommitGraphLane[] = [];
  const rows: CommitGraphRow[] = [];
  const segments: CommitGraphSegment[] = [];
  const isSegmentAddedOfKey: { [key: string]: boolean } = {};
  let laneCount = 1;

  for (const commit of commits) {
    commitOfSha[commit.sha] = commit;
  }

  const readEarliestLaneColorSeedSha = ({
    sha,
    lanesToCheck,
    parentLanes,
  }: {
    sha: string;
    lanesToCheck: CommitGraphLane[];
    parentLanes: CommitGraphLane[];
  }) => {
    const isBoundarySha: { [sha: string]: boolean } = {};
    const isSeenSha: { [sha: string]: boolean } = {};
    let colorSeedSha = sha;

    for (const laneItem of lanesToCheck) {
      isBoundarySha[laneItem.sha] = true;
    }

    for (const laneItem of parentLanes) {
      isBoundarySha[laneItem.sha] = true;
    }

    // Use the oldest commit available for this line before it joins another active line, so newer commits do not repaint the lane.
    while (true) {
      const commit = commitOfSha[colorSeedSha];
      const firstParent = commit?.parents[0];

      if (
        firstParent === undefined ||
        isBoundarySha[firstParent] === true ||
        isSeenSha[firstParent] === true
      ) {
        return colorSeedSha;
      }

      isSeenSha[colorSeedSha] = true;
      colorSeedSha = firstParent;
    }
  };

  const readNewLaneColorIndex = ({
    sha,
    lanesToCheck,
    parentLanes,
  }: {
    sha: string;
    lanesToCheck: CommitGraphLane[];
    parentLanes: CommitGraphLane[];
  }) => {
    const colorSeedSha = readEarliestLaneColorSeedSha({
      sha,
      lanesToCheck,
      parentLanes,
    });
    const preferredColorIndex = readCommitGraphColorIndex(colorSeedSha);
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
    graphItems.push({
      id: `commit:${commit.sha}`,
      commit,
      sha: commit.sha,
      parents: commit.parents,
      threadIds: commit.threadIds,
    });
  }

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

  // Commits are the only graph rows; chat and HEAD markers are row labels so they do not change lane assignment.
  for (const graphItem of graphItems) {
    let lane = lanes.findIndex((laneItem) => laneItem.sha === graphItem.sha);

    if (lane === -1) {
      let colorIndex = colorIndexOfSha[graphItem.sha];

      if (colorIndex === undefined) {
        colorIndex = readNewLaneColorIndex({
          sha: graphItem.sha,
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
      commit: graphItem.commit,
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
        if (parentIndex === 0) {
          parentColorIndex = commitLane.colorIndex;
        } else {
          parentColorIndex = readNewLaneColorIndex({
            sha: parent,
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
  currentBranch,
  commitSha,
  commitShortSha,
  isBranchDeleteSafeOfBranch,
  openBranchDeleteModal,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  refs: string[];
  localBranches: string[];
  currentBranch: string | null;
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
  if (refs.length === 0) {
    return null;
  }

  const hasHead = refs.some((ref) => readIsHeadRef(ref));
  const normalRefs = refs.filter((ref) => ref !== "HEAD");
  const orderedRefs = [
    ...normalRefs.filter(
      (ref) =>
        !ref.startsWith("tag: ") && !cleanRefName(ref).startsWith("origin/"),
    ),
    ...normalRefs.filter(
      (ref) =>
        !ref.startsWith("tag: ") && cleanRefName(ref).startsWith("origin/"),
    ),
    ...normalRefs.filter((ref) => ref.startsWith("tag: ")),
  ];
  const isLocalBranchOfName: { [name: string]: boolean } = {};

  for (const localBranch of localBranches) {
    isLocalBranchOfName[localBranch] = true;
  }

  return (
    <div className="commit-label-list">
      {hasHead ? (
        <span className="commit-ref commit-ref-head" title="HEAD">
          <span>HEAD</span>
        </span>
      ) : null}
      {orderedRefs.map((ref) => {
        const refName = cleanRefName(ref);
        const isLocalBranch = isLocalBranchOfName[refName] === true;
        const isTag = ref.startsWith("tag: ");
        const isOriginBranch = refName.startsWith("origin/");
        let refClassName = "commit-ref commit-ref-local";
        const canDeleteBranch =
          isLocalBranch &&
          refName !== currentBranch &&
          isBranchDeleteSafeOfBranch[refName] === true;

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
            onDoubleClick={(event) => event.stopPropagation()}
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
            {canDeleteBranch ? (
              <button
                className="commit-ref-delete"
                title={`Delete ${refName}`}
                type="button"
                draggable={false}
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
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

const ChatRobotTags = ({
  threads,
  gitChangesOfCwd,
  repoRoot,
  commitSha,
  localBranches,
  currentBranch,
  shouldShowBranchCreateActions,
  openBranchCreateModal,
  openCommitMessageModal,
  openChangeSummaryModal,
}: {
  threads: CodexThread[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  repoRoot: string;
  commitSha: string;
  localBranches: string[];
  currentBranch: string | null;
  shouldShowBranchCreateActions: boolean;
  openBranchCreateModal: (
    event: MouseEvent<HTMLButtonElement>,
    branchCreateTarget: BranchCreateTarget,
  ) => void;
  openCommitMessageModal: (
    event: MouseEvent<HTMLButtonElement>,
    commitMessageTarget: CommitMessageTarget,
  ) => void;
  openChangeSummaryModal: (
    event: MouseEvent<HTMLButtonElement>,
    changeSummaryTarget: ChangeSummaryTarget,
  ) => void;
}) => {
  if (threads.length === 0) {
    return null;
  }

  const openThread = async (threadId: string) => {
    await window.molttree.openCodexThread(threadId);
  };
  const threadGroups: { key: string; cwd: string; threads: CodexThread[] }[] =
    [];
  const groupIndexOfKey: { [key: string]: number } = {};
  const isLocalBranchOfBranch: { [branch: string]: boolean } = {};

  for (const localBranch of localBranches) {
    isLocalBranchOfBranch[localBranch] = true;
  }
  const readCommitBranchTarget = (cwd: string, groupThreads: CodexThread[]) => {
    for (const thread of groupThreads) {
      const threadBranch = thread.gitInfo?.branch ?? null;

      if (
        threadBranch !== null &&
        isLocalBranchOfBranch[threadBranch] === true
      ) {
        const commitBranchTarget: CommitBranchTarget = {
          branch: threadBranch,
          oldSha: commitSha,
        };

        return commitBranchTarget;
      }
    }

    if (
      cwd === repoRoot &&
      currentBranch !== null &&
      isLocalBranchOfBranch[currentBranch] === true
    ) {
      const commitBranchTarget: CommitBranchTarget = {
        branch: currentBranch,
        oldSha: commitSha,
      };

      return commitBranchTarget;
    }

    if (localBranches.length !== 1) {
      return null;
    }

    const localBranch = localBranches[0];

    if (localBranch === undefined) {
      return null;
    }

    const commitBranchTarget: CommitBranchTarget = {
      branch: localBranch,
      oldSha: commitSha,
    };

    return commitBranchTarget;
  };

  for (const thread of threads) {
    const groupKey =
      thread.cwd.length === 0 ? `thread:${thread.id}` : `cwd:${thread.cwd}`;
    const groupIndex = groupIndexOfKey[groupKey];

    if (groupIndex !== undefined) {
      threadGroups[groupIndex].threads.push(thread);
      continue;
    }

    groupIndexOfKey[groupKey] = threadGroups.length;
    threadGroups.push({ key: groupKey, cwd: thread.cwd, threads: [thread] });
  }

  return (
    <div className="commit-label-list">
      {threadGroups.map((threadGroup) => {
        const storedChangeSummary = gitChangesOfCwd[threadGroup.cwd];
        const changeSummary = storedChangeSummary ?? EMPTY_GIT_CHANGE_SUMMARY;
        const totalChangeSummary = readTotalGitChangeSummary(changeSummary);
        const shouldShowChangeCount = storedChangeSummary !== undefined;
        const isChangeSummaryEmpty =
          totalChangeSummary.added === 0 && totalChangeSummary.removed === 0;
        const commitBranchTarget = readCommitBranchTarget(
          threadGroup.cwd,
          threadGroup.threads,
        );
        const changeCountClassName = isChangeSummaryEmpty
          ? "commit-thread-change-count commit-thread-change-count-empty"
          : "commit-thread-change-count";
        const shouldShowBranchCreateAction =
          shouldShowBranchCreateActions &&
          threadGroup.cwd.length > 0 &&
          storedChangeSummary !== undefined &&
          !isChangeSummaryEmpty;
        const shouldShowCommitAction =
          threadGroup.cwd.length > 0 &&
          storedChangeSummary !== undefined &&
          !isChangeSummaryEmpty;

        return (
          <span className="commit-thread-group" key={threadGroup.key}>
            {threadGroup.threads.map((thread) => {
              const title = threadTitle(thread);
              const isThreadActive = readIsThreadActive(thread);

              return (
                <span
                  className="commit-thread-robot"
                  title={isThreadActive ? `${title} is loading` : title}
                  role="button"
                  tabIndex={0}
                  key={thread.id}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void openThread(thread.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    void openThread(thread.id);
                  }}
                >
                  <Bot size={14} />
                </span>
              );
            })}
            {shouldShowChangeCount ? (
              <button
                className={changeCountClassName}
                title={threadGroup.cwd}
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) =>
                  openChangeSummaryModal(event, {
                    path: threadGroup.cwd,
                    title: threadGroup.cwd,
                    changeSummary,
                  })
                }
              >
                <span className="commit-thread-change-added">
                  +{totalChangeSummary.added}
                </span>
                <span className="commit-thread-change-removed">
                  -{totalChangeSummary.removed}
                </span>
              </button>
            ) : null}
            {shouldShowBranchCreateAction ? (
              <button
                className="commit-branch-create-action"
                title={`Create branch for ${threadGroup.cwd}`}
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) =>
                  openBranchCreateModal(event, {
                    path: threadGroup.cwd,
                    title: threadGroup.cwd,
                  })
                }
              >
                <GitBranchPlus size={13} />
              </button>
            ) : null}
            {shouldShowCommitAction ? (
              <button
                className="commit-thread-commit-action"
                title={`Commit changes for ${threadGroup.cwd}`}
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) =>
                  openCommitMessageModal(event, {
                    path: threadGroup.cwd,
                    title: threadGroup.cwd,
                    branchTarget: commitBranchTarget,
                  })
                }
              >
                <Check size={13} />
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
        const path =
          fromX === toX
            ? `M ${fromX} ${fromY} L ${toX} ${toY}`
            : `M ${fromX} ${fromY} L ${toX} ${rowTopConnectionY} L ${toX} ${toY}`;

        return (
          <path
            key={`${segment.fromRowIndex}-${segment.toRowIndex}-${segment.fromLane}-${segment.toLane}-${segment.colorIndex}-${segment.isMergeSegment}`}
            d={path}
            fill="none"
            stroke={readCommitGraphColor(segment.colorIndex)}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {graph.rows.map((row) => {
        const centerX = readCommitGraphX(row.lane);
        const centerY = readCommitGraphY(row.rowIndex);
        const isHead = row.commit.refs.some((ref) => readIsHeadRef(ref));
        const userIconX =
          graphWidth -
          COMMIT_GRAPH_USER_ICON_RIGHT_PADDING -
          COMMIT_GRAPH_USER_ICON_SIZE;

        return (
          <g key={row.id}>
            <circle
              cx={centerX}
              cy={centerY}
              r={COMMIT_GRAPH_DOT_RADIUS}
              fill={readCommitGraphColor(row.colorIndex)}
            />
            {isHead ? (
              <User
                x={userIconX}
                y={centerY - COMMIT_GRAPH_USER_ICON_SIZE / 2}
                size={COMMIT_GRAPH_USER_ICON_SIZE}
                color="#343a43"
                strokeWidth={2}
              />
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
  currentBranch,
  isHeadClean,
  threadOfId,
  gitChangesOfCwd,
  isBranchPointerDropTarget,
  isBranchDeleteSafeOfBranch,
  updateBranchPointerDropTarget,
  clearBranchPointerDropTarget,
  finishBranchPointerDrop,
  openRowAfterDoubleClick,
  openBranchDeleteModal,
  openBranchCreateModal,
  openCommitMessageModal,
  openChangeSummaryModal,
  openBranchMergeModal,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  row: CommitGraphRow;
  repoRoot: string;
  currentBranch: string | null;
  isHeadClean: boolean;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  isBranchPointerDropTarget: boolean;
  isBranchDeleteSafeOfBranch: { [branch: string]: boolean };
  updateBranchPointerDropTarget: (event: DragEvent<HTMLDivElement>) => void;
  clearBranchPointerDropTarget: () => void;
  finishBranchPointerDrop: (event: DragEvent<HTMLDivElement>) => void;
  openRowAfterDoubleClick: () => void;
  openBranchDeleteModal: (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
    oldSha: string,
  ) => void;
  openBranchCreateModal: (
    event: MouseEvent<HTMLButtonElement>,
    branchCreateTarget: BranchCreateTarget,
  ) => void;
  openCommitMessageModal: (
    event: MouseEvent<HTMLButtonElement>,
    commitMessageTarget: CommitMessageTarget,
  ) => void;
  openChangeSummaryModal: (
    event: MouseEvent<HTMLButtonElement>,
    changeSummaryTarget: ChangeSummaryTarget,
  ) => void;
  openBranchMergeModal: (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
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
  const threads = row.threadIds
    .map((rowThreadId) => threadOfId[rowThreadId])
    .filter((rowThread): rowThread is CodexThread => rowThread !== undefined);
  const isHeadRow = commit.refs.some((ref) => readIsHeadRef(ref));
  const mergeableBranches =
    isHeadRow || isHeadClean === false
      ? []
      : commit.localBranches.filter(
          (localBranch) => localBranch !== currentBranch,
        );
  let rowClassName = "commit-history-row";

  if (isBranchPointerDropTarget) {
    rowClassName = `${rowClassName} commit-history-row-branch-drop-target`;
  }

  return (
    <div
      className={rowClassName}
      onDragOver={updateBranchPointerDropTarget}
      onDragLeave={clearBranchPointerDropTarget}
      onDrop={finishBranchPointerDrop}
      onDoubleClick={openRowAfterDoubleClick}
    >
      <div className="commit-graph-cell">
        {mergeableBranches.length === 0 ? null : (
          <div className="commit-graph-actions">
            {mergeableBranches.map((branch) => (
              <button
                className="commit-graph-merge-action"
                title={`Merge ${branch} into HEAD`}
                type="button"
                key={branch}
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => openBranchMergeModal(event, branch)}
              >
                <GitPullRequestArrow size={14} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="commit-actors-cell">
        <ChatRobotTags
          threads={threads}
          gitChangesOfCwd={gitChangesOfCwd}
          repoRoot={repoRoot}
          commitSha={commit.sha}
          localBranches={commit.localBranches}
          currentBranch={currentBranch}
          shouldShowBranchCreateActions={commit.localBranches.length === 0}
          openBranchCreateModal={openBranchCreateModal}
          openCommitMessageModal={openCommitMessageModal}
          openChangeSummaryModal={openChangeSummaryModal}
        />
      </div>
      <div className="commit-branch-tags-cell">
        <BranchTags
          refs={commit.refs}
          localBranches={commit.localBranches}
          currentBranch={currentBranch}
          commitSha={commit.sha}
          commitShortSha={commit.shortSha}
          isBranchDeleteSafeOfBranch={isBranchDeleteSafeOfBranch}
          openBranchDeleteModal={openBranchDeleteModal}
          startBranchPointerDrag={startBranchPointerDrag}
          finishBranchPointerDrag={finishBranchPointerDrag}
        />
      </div>
      <div className="commit-description-cell">
        <span className="commit-subject" title={commit.subject}>
          {commit.subject}
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
  currentBranch,
  gitChangesOfCwd,
  refreshDashboard,
  showErrorMessage,
  rememberBranchTagChange,
}: {
  commits: GitCommit[];
  worktrees: GitWorktree[];
  threadOfId: { [id: string]: CodexThread };
  repoRoot: string;
  currentBranch: string | null;
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
  const branchPointerDragRef = useRef<BranchPointerDrag | null>(null);
  const [branchCreateTarget, setBranchCreateTarget] =
    useState<BranchCreateTarget | null>(null);
  const [branchName, setBranchName] = useState("");
  const [commitMessageTarget, setCommitMessageTarget] =
    useState<CommitMessageTarget | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [changeSummaryTarget, setChangeSummaryTarget] =
    useState<ChangeSummaryTarget | null>(null);
  const [branchToDelete, setBranchToDelete] =
    useState<BranchDeleteTarget | null>(null);
  const [branchMergeConfirmation, setBranchMergeConfirmation] =
    useState<BranchMergeConfirmation | null>(null);
  const [branchPointerMove, setBranchPointerMove] =
    useState<BranchPointerMove | null>(null);
  const [branchPointerDropTargetRowId, setBranchPointerDropTargetRowId] =
    useState<string | null>(null);
  const graph = useMemo(() => createCommitGraph(commits), [commits]);
  const headChangeSummary = gitChangesOfCwd[repoRoot];
  const headTotalChangeSummary =
    headChangeSummary === undefined
      ? EMPTY_GIT_CHANGE_SUMMARY
      : headChangeSummary;
  const totalHeadChangeSummary = readTotalGitChangeSummary(
    headTotalChangeSummary,
  );
  const isHeadClean =
    headChangeSummary !== undefined &&
    totalHeadChangeSummary.added === 0 &&
    totalHeadChangeSummary.removed === 0;
  // Branch delete is safe only when local refs or fixed refs keep the branch tip visible.
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
          continue;
        }

        if (ref !== "HEAD") {
          continue;
        }

        for (const localBranch of commit.localBranches) {
          isBranchCheckedOutOfBranch[localBranch] = true;
        }
      }
    }

    for (const worktree of worktrees) {
      if (worktree.branch !== null) {
        isBranchCheckedOutOfBranch[worktree.branch] = true;
      }
    }

    if (currentBranch !== null) {
      isBranchCheckedOutOfBranch[currentBranch] = true;
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

        if (ref.startsWith("tag: ")) {
          pushRootSha({ sha: commit.sha, ignoredBranch: null });
          continue;
        }

        const refName = cleanRefName(ref);

        if (commit.localBranches.includes(refName)) {
          continue;
        }

        if (refName.startsWith("origin/")) {
          continue;
        }

        pushRootSha({ sha: commit.sha, ignoredBranch: null });
      }
    }

    // Finally test each branch as if the local branch were gone.
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
  }, [commits, currentBranch, worktrees]);
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
  const graphMinimumWidth = readCommitGraphWidth({
    laneCount: visibleGraph.laneCount,
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
  const updateBranchPointerDropTarget = ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    const activeBranchPointerDrag = branchPointerDragRef.current;

    if (activeBranchPointerDrag === null) {
      return;
    }

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
  };
  const clearBranchPointerDropTarget = () => {
    setBranchPointerDropTargetRowId(null);
  };
  const finishBranchPointerDrop = async ({
    event,
    row,
  }: {
    event: DragEvent<HTMLDivElement>;
    row: CommitGraphRow;
  }) => {
    event.preventDefault();
    const activeBranchPointerDrag = branchPointerDragRef.current;

    if (activeBranchPointerDrag === null) {
      finishBranchPointerDrag();
      return;
    }

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
  };
  const refreshDashboardThenShowGitError = async (
    gitErrorMessage: string | null,
  ) => {
    await refreshDashboard();

    if (gitErrorMessage !== null) {
      showErrorMessage(gitErrorMessage);
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
  const openBranchCreateModal = (
    event: MouseEvent<HTMLButtonElement>,
    branchCreateTarget: BranchCreateTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setBranchCreateTarget(branchCreateTarget);
    setBranchName("");
  };
  const closeBranchCreateModal = () => {
    setBranchCreateTarget(null);
    setBranchName("");
  };
  const openCommitMessageModal = (
    event: MouseEvent<HTMLButtonElement>,
    commitMessageTarget: CommitMessageTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setCommitMessageTarget(commitMessageTarget);
    setCommitMessage("");
  };
  const closeCommitMessageModal = () => {
    setCommitMessageTarget(null);
    setCommitMessage("");
  };
  const openChangeSummaryModal = (
    event: MouseEvent<HTMLButtonElement>,
    changeSummaryTarget: ChangeSummaryTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setChangeSummaryTarget(changeSummaryTarget);
  };
  const closeChangeSummaryModal = () => {
    setChangeSummaryTarget(null);
  };
  const closeBranchMergeConfirmationModal = () => {
    setBranchMergeConfirmation(null);
  };
  const closeBranchPointerMoveModal = () => {
    setBranchPointerMove(null);
  };
  const submitBranchName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (branchCreateTarget === null) {
      return;
    }

    const request = branchCreateTarget;
    let gitErrorMessage: string | null = null;

    try {
      await window.molttree.createGitBranch({
        path: request.path,
        branch: branchName.trim(),
      });
      closeBranchCreateModal();
    } catch (error) {
      gitErrorMessage =
        error instanceof Error ? error.message : "Failed to create branch.";
    } finally {
      await refreshDashboardThenShowGitError(gitErrorMessage);
    }
  };
  const submitCommitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (commitMessageTarget === null) {
      return;
    }

    const request = commitMessageTarget;
    let gitErrorMessage: string | null = null;

    try {
      const newSha = await window.molttree.commitAllGitChanges({
        path: request.path,
        message: commitMessage.trim(),
      });

      if (request.branchTarget !== null) {
        await window.molttree.moveGitBranch({
          repoRoot,
          branch: request.branchTarget.branch,
          oldSha: request.branchTarget.oldSha,
          newSha,
        });
        rememberBranchTagChange({
          repoRoot,
          branch: request.branchTarget.branch,
          oldSha: request.branchTarget.oldSha,
          newSha,
        });
      }

      closeCommitMessageModal();
    } catch (error) {
      gitErrorMessage =
        error instanceof Error ? error.message : "Failed to commit changes.";
    } finally {
      await refreshDashboardThenShowGitError(gitErrorMessage);
    }
  };
  const deleteBranchTag = async () => {
    if (branchToDelete === null) {
      return;
    }

    const branchDeleteTarget = branchToDelete;
    closeBranchDeleteModal();
    let gitErrorMessage: string | null = null;

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
      gitErrorMessage =
        error instanceof Error ? error.message : "Failed to delete branch.";
    } finally {
      await refreshDashboardThenShowGitError(gitErrorMessage);
    }
  };
  const openCodePath = async (path: string) => {
    try {
      await window.molttree.openVSCodePath(path);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open code.";
      showErrorMessage(message);
    }
  };
  const openBranchMergeModal = async (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      const preview = await window.molttree.previewGitMerge({
        repoRoot,
        branch,
      });
      setBranchMergeConfirmation({ branch, preview });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to preview merge.";
      showErrorMessage(message);
    }
  };
  const confirmBranchMerge = async () => {
    if (branchMergeConfirmation === null) {
      return;
    }

    const request = branchMergeConfirmation;
    closeBranchMergeConfirmationModal();
    let mergeErrorMessage: string | null = null;

    try {
      await window.molttree.mergeGitBranch({
        repoRoot,
        branch: request.branch,
      });
    } catch (error) {
      mergeErrorMessage =
        error instanceof Error ? error.message : "Failed to start merge.";
    } finally {
      await refreshDashboardThenShowGitError(mergeErrorMessage);
    }
  };
  const moveBranchPointer = async () => {
    if (branchPointerMove === null) {
      return;
    }

    const request = branchPointerMove;
    closeBranchPointerMoveModal();
    let gitErrorMessage: string | null = null;

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
      gitErrorMessage =
        error instanceof Error ? error.message : "Failed to move branch.";
    } finally {
      await refreshDashboardThenShowGitError(gitErrorMessage);
    }
  };
  const openRowAfterDoubleClick = async (row: CommitGraphRow) => {
    let gitErrorMessage: string | null = null;

    try {
      await window.molttree.checkoutGitCommit({
        repoRoot,
        sha: row.commit.sha,
      });
    } catch (error) {
      gitErrorMessage =
        error instanceof Error ? error.message : "Failed to switch HEAD.";
    } finally {
      await refreshDashboardThenShowGitError(gitErrorMessage);
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
            <span>Actors</span>
            <CommitHistoryColumnResizeHandle
              columnKey="actors"
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
          <CommitGraphSvg graph={visibleGraph} graphWidth={graphWidth} />
          {visibleGraph.rows.map((row) => (
            <CommitHistoryRow
              key={row.id}
              row={row}
              repoRoot={repoRoot}
              currentBranch={currentBranch}
              isHeadClean={isHeadClean}
              threadOfId={threadOfId}
              gitChangesOfCwd={gitChangesOfCwd}
              isBranchPointerDropTarget={
                branchPointerDropTargetRowId === row.id
              }
              isBranchDeleteSafeOfBranch={isBranchDeleteSafeOfBranch}
              updateBranchPointerDropTarget={(event) =>
                updateBranchPointerDropTarget({ event, row })
              }
              clearBranchPointerDropTarget={clearBranchPointerDropTarget}
              finishBranchPointerDrop={(event) =>
                finishBranchPointerDrop({ event, row })
              }
              openRowAfterDoubleClick={() => openRowAfterDoubleClick(row)}
              openBranchDeleteModal={openBranchDeleteModal}
              openBranchCreateModal={openBranchCreateModal}
              openCommitMessageModal={openCommitMessageModal}
              openChangeSummaryModal={openChangeSummaryModal}
              openBranchMergeModal={openBranchMergeModal}
              startBranchPointerDrag={startBranchPointerDrag}
              finishBranchPointerDrag={finishBranchPointerDrag}
            />
          ))}
        </div>
        {branchCreateTarget === null ? null : (
          <div className="commit-message-modal-backdrop">
            <form className="commit-message-modal" onSubmit={submitBranchName}>
              <h3>Create Branch</h3>
              <p className="branch-delete-modal-message">
                Create a branch for {branchCreateTarget.title}.
              </p>
              <input
                autoFocus
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
              />
              <div className="commit-message-modal-actions">
                <button type="button" onClick={closeBranchCreateModal}>
                  Cancel
                </button>
                <button type="submit" disabled={branchName.trim().length === 0}>
                  Create
                </button>
              </div>
            </form>
          </div>
        )}
        {commitMessageTarget === null ? null : (
          <div className="commit-message-modal-backdrop">
            <form
              className="commit-message-modal"
              onSubmit={submitCommitMessage}
            >
              <h3>Commit Changes</h3>
              <p className="branch-delete-modal-message">
                Commit changes for {commitMessageTarget.title}.
              </p>
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
        {changeSummaryTarget === null ? null : (
          <div
            className="commit-message-modal-backdrop"
            onClick={closeChangeSummaryModal}
          >
            <div
              className="commit-message-modal change-summary-modal"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <h3>Change Summary</h3>
              <p className="branch-delete-modal-message">
                {changeSummaryTarget.title}
              </p>
              <div className="change-summary-breakdown">
                <div
                  className={
                    changeSummaryTarget.changeSummary.staged.added === 0 &&
                    changeSummaryTarget.changeSummary.staged.removed === 0
                      ? "change-summary-row change-summary-row-empty"
                      : "change-summary-row"
                  }
                >
                  <span>Staged</span>
                  <span className="commit-thread-change-added">
                    +{changeSummaryTarget.changeSummary.staged.added}
                  </span>
                  <span className="commit-thread-change-removed">
                    -{changeSummaryTarget.changeSummary.staged.removed}
                  </span>
                </div>
                <div
                  className={
                    changeSummaryTarget.changeSummary.unstaged.added === 0 &&
                    changeSummaryTarget.changeSummary.unstaged.removed === 0
                      ? "change-summary-row change-summary-row-empty"
                      : "change-summary-row"
                  }
                >
                  <span>Unstaged</span>
                  <span className="commit-thread-change-added">
                    +{changeSummaryTarget.changeSummary.unstaged.added}
                  </span>
                  <span className="commit-thread-change-removed">
                    -{changeSummaryTarget.changeSummary.unstaged.removed}
                  </span>
                </div>
              </div>
              <button
                className="change-summary-modal-link"
                type="button"
                onClick={() => {
                  void openCodePath(changeSummaryTarget.path);
                }}
              >
                Open repo
              </button>
            </div>
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
        {branchMergeConfirmation === null ? null : (
          <div className="commit-message-modal-backdrop">
            <div className="commit-message-modal">
              <h3>Merge Branches</h3>
              <p className="branch-delete-modal-message">
                Merge {branchMergeConfirmation.branch} into HEAD?
              </p>
              <p className="branch-delete-modal-message">
                +{branchMergeConfirmation.preview.added} -
                {branchMergeConfirmation.preview.removed} with{" "}
                {branchMergeConfirmation.preview.conflictCount} conflicts.
              </p>
              <div className="commit-message-modal-actions">
                <button
                  type="button"
                  onClick={closeBranchMergeConfirmationModal}
                >
                  Cancel
                </button>
                <button type="button" onClick={confirmBranchMerge}>
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
          currentBranch={repo.currentBranch}
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
        {threads.slice(0, 80).map((thread) => {
          const title = threadTitle(thread);
          const isThreadActive = readIsThreadActive(thread);

          return (
            <button
              className="sidebar-thread"
              key={thread.id}
              onClick={() => window.molttree.openCodexThread(thread.id)}
            >
              <div className="sidebar-thread-title">
                <span>{title}</span>
                {isThreadActive ? (
                  <RefreshCw className="thread-loading-icon" size={13} />
                ) : null}
              </div>
              <small>{thread.gitInfo?.branch ?? thread.cwd}</small>
              <small>{formatDate(thread.updatedAt)}</small>
            </button>
          );
        })}
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
      setBranchTagChanges((currentBranchTagChanges) =>
        syncBranchTagChangesWithDashboardData({
          branchTagChanges: currentBranchTagChanges,
          dashboardData: nextDashboardData,
        }),
      );

      if (nextDashboardData.gitErrors.length > 0) {
        setSuccessMessage(null);
        setErrorMessage(nextDashboardData.gitErrors.join("\n"));
      }
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
    let gitErrorMessage: string | null = null;

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
      gitErrorMessage =
        error instanceof Error
          ? error.message
          : "Failed to apply branch tag changes.";
    } finally {
      await refreshDashboard();

      if (gitErrorMessage !== null) {
        showErrorMessage(gitErrorMessage);
      }
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
          <h1>MoltTree</h1>
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
