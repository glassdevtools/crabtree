import {
  Check,
  Download,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Trash2,
  Undo2,
  Upload,
  User,
} from "lucide-react";
import { IoChatbubbleOutline } from "react-icons/io5";
import { MdOutlineCallSplit } from "react-icons/md";
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
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

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
// Dashboard reads touch Codex and Git, so automatic refreshes share the manual refresh path and never overlap.
// TODO: AI-PICKED-VALUE: Refreshing every second keeps branch/worktree state current while the refresh queue prevents overlapping Git reads.
const DASHBOARD_REFRESH_INTERVAL_MS = 1000;
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

const readBranchTagChangeActionText = (
  action: BranchTagChangeAction,
): BranchTagChangeActionText => {
  switch (action) {
    case "push":
      return {
        title: "Push Branch Tag Changes",
        message:
          "Are you sure you want to push branch tag changes for this repo?",
        buttonText: "Push",
        successMessage: "Branch tag changes pushed.",
      };
    case "pull":
      return {
        title: "Pull Branch Tag Changes",
        message:
          "Are you sure you want to pull branch tag changes from origin for this repo?",
        buttonText: "Pull",
        successMessage: "Branch tag changes pulled.",
      };
    case "reset":
      return {
        title: "Reset Branch Tag Changes",
        message:
          "Are you sure you want to reset branch tag changes for this repo to match origin?",
        buttonText: "Reset",
        successMessage: "Branch tag changes reset.",
      };
  }
};

const readRepoFolderName = (repo: RepoGraph) => {
  return repo.root.split("/").pop() ?? repo.root;
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
  oldSubject: string;
};

type BranchPointerMove = {
  repoRoot: string;
  branch: string;
  oldSha: string;
  oldShortSha: string;
  oldSubject: string;
  newSha: string;
  newShortSha: string;
  newSubject: string;
  willMoveCheckedOutWorktree: boolean;
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

type ThreadGroup = {
  key: string;
  cwd: string;
  threads: CodexThread[];
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

type BranchTagChangeAction = "push" | "pull" | "reset";

type BranchTagChangeActionText = {
  title: string;
  message: string;
  buttonText: string;
  successMessage: string;
};

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

    // dsf
    // setFdLimitdsf
    // sdf
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

const readIsWorktreeCwd = ({
  cwd,
  worktrees,
}: {
  cwd: string;
  worktrees: GitWorktree[];
}) => {
  for (const worktree of worktrees) {
    if (cwd === worktree.path || cwd.startsWith(`${worktree.path}/`)) {
      return true;
    }
  }

  return false;
};

const readDisplayedThreadGroups = ({
  threads,
  worktrees,
}: {
  threads: CodexThread[];
  worktrees: GitWorktree[];
}) => {
  const threadGroups: ThreadGroup[] = [];
  const groupIndexOfKey: { [key: string]: number } = {};

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

  return [
    ...threadGroups.filter(
      (threadGroup) => !readIsWorktreeCwd({ cwd: threadGroup.cwd, worktrees }),
    ),
    ...threadGroups.filter((threadGroup) =>
      readIsWorktreeCwd({ cwd: threadGroup.cwd, worktrees }),
    ),
  ];
};

const readIsLocalBranch = ({
  branch,
  localBranches,
}: {
  branch: string;
  localBranches: string[];
}) => {
  for (const localBranch of localBranches) {
    if (localBranch === branch) {
      return true;
    }
  }

  return false;
};

const readCommitBranchTarget = ({
  cwd,
  groupThreads,
  repoRoot,
  currentBranch,
  localBranches,
  commitSha,
}: {
  cwd: string;
  groupThreads: CodexThread[];
  repoRoot: string;
  currentBranch: string | null;
  localBranches: string[];
  commitSha: string;
}) => {
  for (const thread of groupThreads) {
    const threadBranch = thread.gitInfo?.branch ?? null;

    if (
      threadBranch !== null &&
      readIsLocalBranch({ branch: threadBranch, localBranches })
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
    readIsLocalBranch({ branch: currentBranch, localBranches })
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

const BranchTags = ({
  refs,
  worktrees,
  localBranches,
  currentBranch,
  defaultBranch,
  commitSha,
  commitShortSha,
  commitSubject,
  isBranchDeleteSafeOfBranch,
  openBranchDeleteModal,
  openCodePath,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  refs: string[];
  worktrees: GitWorktree[];
  localBranches: string[];
  currentBranch: string | null;
  defaultBranch: string | null;
  commitSha: string;
  commitShortSha: string;
  commitSubject: string;
  isBranchDeleteSafeOfBranch: { [branch: string]: boolean };
  openBranchDeleteModal: (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
    oldSha: string,
  ) => void;
  openCodePath: (path: string) => Promise<void>;
  startBranchPointerDrag: ({
    event,
    branch,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    branch: string;
    oldSha: string;
    oldShortSha: string;
    oldSubject: string;
  }) => void;
  finishBranchPointerDrag: () => void;
}) => {
  const worktreesForCommit = worktrees.filter(
    (worktree) => worktree.head === commitSha,
  );
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

  if (!hasHead && orderedRefs.length === 0 && worktreesForCommit.length === 0) {
    return null;
  }

  return (
    <div className="commit-label-list">
      {hasHead ? (
        <Badge
          className="commit-ref commit-ref-head"
          variant="secondary"
          title="HEAD"
        >
          <span>HEAD</span>
        </Badge>
      ) : null}
      {worktreesForCommit.map((worktree) => (
        <Badge
          asChild
          className="commit-ref commit-ref-head commit-ref-worktree"
          variant="secondary"
          title={`Open ${worktree.path}`}
          key={worktree.path}
        >
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void openCodePath(worktree.path);
            }}
          >
            <MdOutlineCallSplit
              aria-hidden="true"
              className="commit-ref-worktree-icon"
              size={13}
            />
            <span>Worktree</span>
          </Button>
        </Badge>
      ))}
      {orderedRefs.map((ref) => {
        const refName = cleanRefName(ref);
        const isLocalBranch = isLocalBranchOfName[refName] === true;
        const isTag = ref.startsWith("tag: ");
        const isOriginBranch = refName.startsWith("origin/");
        let refClassName = "commit-ref commit-ref-local";
        const canDeleteBranch =
          isLocalBranch &&
          refName !== currentBranch &&
          refName !== defaultBranch &&
          isBranchDeleteSafeOfBranch[refName] === true;

        if (isOriginBranch) {
          refClassName = "commit-ref commit-ref-origin";
        }

        if (isTag) {
          refClassName = "commit-ref commit-ref-tag";
        }

        return (
          <Badge
            className={cn(
              refClassName,
              isLocalBranch && "commit-ref-draggable",
            )}
            variant="secondary"
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
                oldSubject: commitSubject,
              });
            }}
            onDragEnd={finishBranchPointerDrag}
          >
            <span>{refName}</span>
            {canDeleteBranch ? (
              <Button
                className="commit-ref-delete"
                variant="ghost"
                size="icon-xs"
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
              </Button>
            ) : null}
          </Badge>
        );
      })}
    </div>
  );
};

const ChatRobotTags = ({
  threadGroups,
  gitChangesOfCwd,
  worktrees,
  repoRoot,
  commitSha,
  localBranches,
  currentBranch,
  openCommitMessageModal,
  openChangeSummaryModal,
}: {
  threadGroups: ThreadGroup[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  worktrees: GitWorktree[];
  repoRoot: string;
  commitSha: string;
  localBranches: string[];
  currentBranch: string | null;
  openCommitMessageModal: (
    event: MouseEvent<HTMLButtonElement>,
    commitMessageTarget: CommitMessageTarget,
  ) => void;
  openChangeSummaryModal: (
    event: MouseEvent<HTMLButtonElement>,
    changeSummaryTarget: ChangeSummaryTarget,
  ) => void;
}) => {
  if (threadGroups.length === 0) {
    return null;
  }

  const openThread = async (threadId: string) => {
    await window.molttree.openCodexThread(threadId);
  };

  return (
    <div className="commit-label-list commit-thread-group-list">
      {threadGroups.map((threadGroup) => {
        const storedChangeSummary = gitChangesOfCwd[threadGroup.cwd];
        const changeSummary = storedChangeSummary ?? EMPTY_GIT_CHANGE_SUMMARY;
        const totalChangeSummary = readTotalGitChangeSummary(changeSummary);
        const isChangeSummaryEmpty =
          totalChangeSummary.added === 0 && totalChangeSummary.removed === 0;
        const shouldShowChangeCount =
          storedChangeSummary !== undefined && !isChangeSummaryEmpty;
        const commitBranchTarget = readCommitBranchTarget({
          cwd: threadGroup.cwd,
          groupThreads: threadGroup.threads,
          repoRoot,
          currentBranch,
          localBranches,
          commitSha,
        });
        const shouldShowCommitAction =
          threadGroup.cwd.length > 0 &&
          shouldShowChangeCount &&
          commitBranchTarget !== null;
        return (
          <span className="commit-thread-group" key={threadGroup.key}>
            {threadGroup.threads.map((thread) => {
              const title = threadTitle(thread);
              const isThreadActive = readIsThreadActive(thread);

              return (
                <Button
                  className="commit-thread-chat"
                  variant="ghost"
                  size="icon-xs"
                  title={isThreadActive ? `${title} is loading` : title}
                  type="button"
                  key={thread.id}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void openThread(thread.id);
                  }}
                >
                  <IoChatbubbleOutline size={17} />
                  {readIsWorktreeCwd({ cwd: thread.cwd, worktrees }) ? (
                    <MdOutlineCallSplit
                      aria-hidden="true"
                      className="commit-thread-worktree-mark"
                      size={10}
                    />
                  ) : null}
                </Button>
              );
            })}
            {shouldShowChangeCount ? (
              <Button
                className="commit-thread-change-count"
                variant="ghost"
                size="xs"
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
              </Button>
            ) : null}
            {shouldShowCommitAction ? (
              <Button
                className="commit-thread-commit-action"
                variant="ghost"
                size="icon-xs"
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
              </Button>
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
  worktrees,
  currentBranch,
  defaultBranch,
  isHeadClean,
  threadOfId,
  gitChangesOfCwd,
  isBranchPointerDropTarget,
  isHeadAncestor,
  isAfterHead,
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
  openCodePath,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  row: CommitGraphRow;
  repoRoot: string;
  worktrees: GitWorktree[];
  currentBranch: string | null;
  defaultBranch: string | null;
  isHeadClean: boolean;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  isBranchPointerDropTarget: boolean;
  isHeadAncestor: boolean;
  isAfterHead: boolean;
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
  openCodePath: (path: string) => Promise<void>;
  startBranchPointerDrag: ({
    event,
    branch,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    branch: string;
    oldSha: string;
    oldShortSha: string;
    oldSubject: string;
  }) => void;
  finishBranchPointerDrag: () => void;
}) => {
  const { commit } = row;
  const threads = row.threadIds
    .map((rowThreadId) => threadOfId[rowThreadId])
    .filter((rowThread): rowThread is CodexThread => rowThread !== undefined);
  const threadGroups = readDisplayedThreadGroups({ threads, worktrees });
  const isHeadRow = commit.refs.some((ref) => readIsHeadRef(ref));
  const mergeBranch =
    isHeadRow || isHeadAncestor || isAfterHead
      ? null
      : (commit.localBranches.find(
          (localBranch) => localBranch !== currentBranch,
        ) ?? null);
  let mergeDisabledReason: string | null = null;
  let branchCreateTarget: BranchCreateTarget | null = null;
  let rowClassName = "commit-history-row";

  if (mergeBranch !== null && isHeadClean === false) {
    mergeDisabledReason =
      "Current HEAD working tree must be clean before merging.";
  }

  if (commit.localBranches.length === 0) {
    for (const threadGroup of threadGroups) {
      if (threadGroup.cwd.length === 0) {
        continue;
      }

      branchCreateTarget = {
        path: threadGroup.cwd,
        title: threadGroup.cwd,
      };
      break;
    }
  }

  if (isBranchPointerDropTarget) {
    rowClassName = `${rowClassName} commit-history-row-branch-drop-target`;
  }

  return (
    <div
      className={rowClassName}
      onDragOver={updateBranchPointerDropTarget}
      onDragLeave={clearBranchPointerDropTarget}
      onDrop={finishBranchPointerDrop}
    >
      <div
        className="commit-graph-cell"
        onDoubleClick={openRowAfterDoubleClick}
      >
        {branchCreateTarget === null && mergeBranch === null ? null : (
          <div className="commit-graph-actions">
            {branchCreateTarget !== null ? (
              <Button
                className="commit-branch-create-action"
                variant="ghost"
                size="icon-xs"
                title={`Create branch for ${branchCreateTarget.title}`}
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) =>
                  openBranchCreateModal(event, branchCreateTarget)
                }
              >
                <GitBranch size={14} />
              </Button>
            ) : mergeBranch === null ? null : (
              <Button
                className="commit-graph-merge-action"
                variant="ghost"
                size="icon-xs"
                title={
                  mergeDisabledReason === null
                    ? `Merge ${mergeBranch} into HEAD`
                    : mergeDisabledReason
                }
                type="button"
                disabled={mergeDisabledReason !== null}
                onMouseDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => openBranchMergeModal(event, mergeBranch)}
              >
                <GitPullRequestArrow size={14} />
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="commit-actors-cell">
        <ChatRobotTags
          threadGroups={threadGroups}
          gitChangesOfCwd={gitChangesOfCwd}
          worktrees={worktrees}
          repoRoot={repoRoot}
          commitSha={commit.sha}
          localBranches={commit.localBranches}
          currentBranch={currentBranch}
          openCommitMessageModal={openCommitMessageModal}
          openChangeSummaryModal={openChangeSummaryModal}
        />
      </div>
      <div className="commit-branch-tags-cell">
        <BranchTags
          refs={commit.refs}
          worktrees={worktrees}
          localBranches={commit.localBranches}
          currentBranch={currentBranch}
          defaultBranch={defaultBranch}
          commitSha={commit.sha}
          commitShortSha={commit.shortSha}
          commitSubject={commit.subject}
          isBranchDeleteSafeOfBranch={isBranchDeleteSafeOfBranch}
          openBranchDeleteModal={openBranchDeleteModal}
          openCodePath={openCodePath}
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
    <Button
      className="commit-history-column-resize"
      variant="ghost"
      size="icon-xs"
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
  defaultBranch,
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
  defaultBranch: string | null;
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
  const isHeadAncestorOfSha = useMemo(() => {
    const commitOfSha: { [sha: string]: GitCommit } = {};
    const nextIsHeadAncestorOfSha: { [sha: string]: boolean } = {};
    let headSha: string | null = null;

    for (const commit of commits) {
      commitOfSha[commit.sha] = commit;

      if (commit.refs.some((ref) => readIsHeadRef(ref))) {
        headSha = commit.sha;
      }
    }

    if (headSha === null) {
      return nextIsHeadAncestorOfSha;
    }

    const shasToRead = [headSha];

    while (shasToRead.length > 0) {
      const sha = shasToRead.pop();

      if (sha === undefined || nextIsHeadAncestorOfSha[sha] === true) {
        continue;
      }

      nextIsHeadAncestorOfSha[sha] = true;
      const commit = commitOfSha[sha];

      if (commit === undefined) {
        continue;
      }

      for (const parent of commit.parents) {
        shasToRead.push(parent);
      }
    }

    return nextIsHeadAncestorOfSha;
  }, [commits]);
  const isAfterHeadOfSha = useMemo(() => {
    const childShasOfSha: { [sha: string]: string[] } = {};
    const nextIsAfterHeadOfSha: { [sha: string]: boolean } = {};
    let headSha: string | null = null;

    for (const commit of commits) {
      if (commit.refs.some((ref) => readIsHeadRef(ref))) {
        headSha = commit.sha;
      }

      for (const parent of commit.parents) {
        if (childShasOfSha[parent] === undefined) {
          childShasOfSha[parent] = [];
        }

        childShasOfSha[parent].push(commit.sha);
      }
    }

    if (headSha === null) {
      return nextIsAfterHeadOfSha;
    }

    const shasToRead = [...(childShasOfSha[headSha] ?? [])];

    while (shasToRead.length > 0) {
      const sha = shasToRead.pop();

      if (sha === undefined || nextIsAfterHeadOfSha[sha] === true) {
        continue;
      }

      nextIsAfterHeadOfSha[sha] = true;

      for (const childSha of childShasOfSha[sha] ?? []) {
        shasToRead.push(childSha);
      }
    }

    return nextIsAfterHeadOfSha;
  }, [commits]);
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
  const commitOfSha = useMemo(() => {
    const nextCommitOfSha: { [sha: string]: GitCommit } = {};

    for (const commit of commits) {
      nextCommitOfSha[commit.sha] = commit;
    }

    return nextCommitOfSha;
  }, [commits]);
  const readIsAncestorInVisibleGraph = ({
    ancestorSha,
    descendantSha,
  }: {
    ancestorSha: string;
    descendantSha: string;
  }) => {
    const shasToRead = [descendantSha];
    const isReadSha: { [sha: string]: boolean } = {};

    while (shasToRead.length > 0) {
      const sha = shasToRead.pop();

      if (sha === undefined || isReadSha[sha] === true) {
        continue;
      }

      if (sha === ancestorSha) {
        return true;
      }

      isReadSha[sha] = true;
      const commit = commitOfSha[sha];

      if (commit === undefined) {
        continue;
      }

      for (const parent of commit.parents) {
        shasToRead.push(parent);
      }
    }

    return false;
  };
  const readIsBranchMoveSafe = ({
    branch,
    oldSha,
    newSha,
  }: {
    branch: string;
    oldSha: string;
    newSha: string;
  }) => {
    if (
      readIsAncestorInVisibleGraph({
        ancestorSha: oldSha,
        descendantSha: newSha,
      })
    ) {
      return true;
    }

    for (const commit of commits) {
      for (const localBranch of commit.localBranches) {
        if (
          localBranch !== branch &&
          readIsAncestorInVisibleGraph({
            ancestorSha: oldSha,
            descendantSha: commit.sha,
          })
        ) {
          return true;
        }
      }

      for (const ref of commit.refs) {
        if (
          (ref === "HEAD" || ref.startsWith("tag: ")) &&
          readIsAncestorInVisibleGraph({
            ancestorSha: oldSha,
            descendantSha: commit.sha,
          })
        ) {
          return true;
        }
      }
    }

    for (const worktree of worktrees) {
      if (
        worktree.branch !== branch &&
        worktree.head !== null &&
        readIsAncestorInVisibleGraph({
          ancestorSha: oldSha,
          descendantSha: worktree.head,
        })
      ) {
        return true;
      }
    }

    return false;
  };
  const readIsBranchCheckedOut = (branch: string) => {
    if (currentBranch === branch) {
      return true;
    }

    for (const worktree of worktrees) {
      if (worktree.branch === branch) {
        return true;
      }
    }

    return false;
  };
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
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    branch: string;
    oldSha: string;
    oldShortSha: string;
    oldSubject: string;
  }) => {
    const nextBranchPointerDrag = {
      repoRoot,
      branch,
      oldSha,
      oldShortSha,
      oldSubject,
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
    if (
      readIsBranchMoveSafe({
        branch: activeBranchPointerDrag.branch,
        oldSha: activeBranchPointerDrag.oldSha,
        newSha: row.commit.sha,
      })
    ) {
      event.dataTransfer.dropEffect = "move";
      setBranchPointerDropTargetRowId(row.id);
      return;
    }

    event.dataTransfer.dropEffect = "none";
    setBranchPointerDropTargetRowId(null);
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

    if (
      !readIsBranchMoveSafe({
        branch: activeBranchPointerDrag.branch,
        oldSha: activeBranchPointerDrag.oldSha,
        newSha: row.commit.sha,
      })
    ) {
      showErrorMessage(
        `Moving ${activeBranchPointerDrag.branch} would make ${activeBranchPointerDrag.oldShortSha} unreachable from local branches, tags, or detached worktrees. Create another branch first.`,
      );
      finishBranchPointerDrag();
      return;
    }

    setBranchPointerMove({
      repoRoot,
      branch: activeBranchPointerDrag.branch,
      oldSha: activeBranchPointerDrag.oldSha,
      oldShortSha: activeBranchPointerDrag.oldShortSha,
      oldSubject: activeBranchPointerDrag.oldSubject,
      newSha: row.commit.sha,
      newShortSha: row.commit.shortSha,
      newSubject: row.commit.subject,
      willMoveCheckedOutWorktree: readIsBranchCheckedOut(
        activeBranchPointerDrag.branch,
      ),
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
        oldSha: branchDeleteTarget.oldSha,
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
    } finally {
      void refreshDashboard();
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
      <Label className="commit-history-filter">
        <Checkbox
          checked={shouldShowChatOnly}
          onCheckedChange={(checked) => setShouldShowChatOnly(checked === true)}
        />
        Show chats only
      </Label>
      <Card className="commit-history gap-0 py-0" ref={commitHistoryRef}>
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
              worktrees={worktrees}
              currentBranch={currentBranch}
              defaultBranch={defaultBranch}
              isHeadClean={isHeadClean}
              threadOfId={threadOfId}
              gitChangesOfCwd={gitChangesOfCwd}
              isBranchPointerDropTarget={
                branchPointerDropTargetRowId === row.id
              }
              isHeadAncestor={isHeadAncestorOfSha[row.commit.sha] === true}
              isAfterHead={isAfterHeadOfSha[row.commit.sha] === true}
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
              openCodePath={openCodePath}
              startBranchPointerDrag={startBranchPointerDrag}
              finishBranchPointerDrag={finishBranchPointerDrag}
            />
          ))}
        </div>
        <Dialog
          open={branchCreateTarget !== null}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              return;
            }

            closeBranchCreateModal();
          }}
        >
          {branchCreateTarget === null ? null : (
            <DialogContent className="sm:max-w-sm">
              <form className="grid gap-4" onSubmit={submitBranchName}>
                <DialogHeader>
                  <DialogTitle>Create Branch</DialogTitle>
                  <DialogDescription>
                    Create a branch for {branchCreateTarget.title}.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  autoFocus
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeBranchCreateModal}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={branchName.trim().length === 0}
                  >
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          )}
        </Dialog>
        <Dialog
          open={commitMessageTarget !== null}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              return;
            }

            closeCommitMessageModal();
          }}
        >
          {commitMessageTarget === null ? null : (
            <DialogContent className="sm:max-w-sm">
              <form className="grid gap-4" onSubmit={submitCommitMessage}>
                <DialogHeader>
                  <DialogTitle>Commit Changes</DialogTitle>
                  <DialogDescription>
                    Commit changes for {commitMessageTarget.title}.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  autoFocus
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeCommitMessageModal}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={commitMessage.trim().length === 0}
                  >
                    Commit
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          )}
        </Dialog>
        <Dialog
          open={changeSummaryTarget !== null}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              return;
            }

            closeChangeSummaryModal();
          }}
        >
          {changeSummaryTarget === null ? null : (
            <DialogContent className="change-summary-modal sm:max-w-[720px]">
              <DialogHeader>
                <DialogTitle>Change Summary</DialogTitle>
                <DialogDescription className="[overflow-wrap:anywhere]">
                  {changeSummaryTarget.title}
                </DialogDescription>
              </DialogHeader>
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
              <Button
                className="change-summary-modal-link"
                variant="link"
                type="button"
                onClick={() => {
                  void openCodePath(changeSummaryTarget.path);
                }}
              >
                Open repo
              </Button>
            </DialogContent>
          )}
        </Dialog>
        <AlertDialog
          open={branchToDelete !== null}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              return;
            }

            closeBranchDeleteModal();
          }}
        >
          {branchToDelete === null ? null : (
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Branch Tag</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete the {branchToDelete.branch}{" "}
                  tag?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={closeBranchDeleteModal}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={deleteBranchTag}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>
        <AlertDialog
          open={branchMergeConfirmation !== null}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              return;
            }

            closeBranchMergeConfirmationModal();
          }}
        >
          {branchMergeConfirmation === null ? null : (
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Merge Branches</AlertDialogTitle>
                <AlertDialogDescription>
                  Merge {branchMergeConfirmation.branch} into HEAD?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="branch-merge-preview-message">
                <span className="commit-thread-change-added">
                  +{branchMergeConfirmation.preview.added}
                </span>
                <span className="commit-thread-change-removed">
                  -{branchMergeConfirmation.preview.removed}
                </span>
                <span>
                  with{" "}
                  <strong
                    className={
                      branchMergeConfirmation.preview.conflictCount === 0
                        ? "branch-merge-conflict-count branch-merge-conflict-count-empty"
                        : "branch-merge-conflict-count"
                    }
                  >
                    {branchMergeConfirmation.preview.conflictCount} conflicts
                  </strong>
                  .
                </span>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={closeBranchMergeConfirmationModal}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={confirmBranchMerge}>
                  Merge
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>
        <AlertDialog
          open={branchPointerMove !== null}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              return;
            }

            closeBranchPointerMoveModal();
          }}
        >
          {branchPointerMove === null ? null : (
            <AlertDialogContent className="branch-pointer-move-modal sm:max-w-[560px]">
              <AlertDialogHeader>
                <AlertDialogTitle>Move Branch Pointer</AlertDialogTitle>
                <AlertDialogDescription>
                  Move the {branchPointerMove.branch} branch pointer?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ul className="branch-tag-change-list">
                <li>
                  <strong>From</strong>
                  <span>
                    <code>{branchPointerMove.oldShortSha}</code>{" "}
                    {branchPointerMove.oldSubject}
                  </span>
                </li>
                <li>
                  <strong>To</strong>
                  <span>
                    <code>{branchPointerMove.newShortSha}</code>{" "}
                    {branchPointerMove.newSubject}
                  </span>
                </li>
              </ul>
              <AlertDialogDescription>
                {branchPointerMove.willMoveCheckedOutWorktree
                  ? "This branch is checked out in a clean worktree, so Git will reset that worktree to the target commit."
                  : "No worktree files will be changed."}
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={closeBranchPointerMoveModal}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={moveBranchPointer}>
                  Move
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>
      </Card>
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
  const repoFolderName = readRepoFolderName(repo);

  return (
    <section className="repo-section">
      <div className="repo-header">
        <div className="repo-title">{repoFolderName}</div>
        <div className="repo-actions">
          <Button
            className="icon-button"
            variant="outline"
            size="icon"
            title="Reset branch tag changes for this repo"
            type="button"
            onClick={() => openBranchTagChangeModal("reset", repo.root)}
            disabled={repoBranchTagChanges.length === 0}
          >
            <Undo2 size={18} />
          </Button>
          <Button
            className="icon-button"
            variant="outline"
            size="icon"
            title="Pull branch tag changes from origin for this repo"
            type="button"
            onClick={() => openBranchTagChangeModal("pull", repo.root)}
            disabled={repoBranchTagChanges.length === 0}
          >
            <Download size={18} />
          </Button>
          <Button
            className="icon-button"
            variant="outline"
            size="icon"
            title="Push branch tag changes for this repo"
            type="button"
            onClick={() => openBranchTagChangeModal("push", repo.root)}
            disabled={repoBranchTagChanges.length === 0}
          >
            <Upload size={18} />
          </Button>
        </div>
      </div>

      <div className="repo-panel">
        <CommitHistory
          commits={repo.commits}
          worktrees={repo.worktrees}
          threadOfId={threadOfId}
          repoRoot={repo.root}
          currentBranch={repo.currentBranch}
          defaultBranch={repo.defaultBranch}
          gitChangesOfCwd={gitChangesOfCwd}
          refreshDashboard={refreshDashboard}
          showErrorMessage={showErrorMessage}
          rememberBranchTagChange={rememberBranchTagChange}
        />
      </div>
    </section>
  );
};

export const App = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [selectedRepoRoot, setSelectedRepoRoot] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(
    null,
  );
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<
    string | null
  >(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [branchTagChanges, setBranchTagChanges] = useState<
    GitBranchTagChange[]
  >([]);
  const [branchTagChangeConfirmation, setBranchTagChangeConfirmation] =
    useState<BranchTagChangeConfirmation | null>(null);
  const isDashboardRefreshRunningRef = useRef(false);
  const shouldRefreshDashboardAgainRef = useRef(false);
  const dashboardRefreshPromiseRef = useRef<Promise<void> | null>(null);

  const threadOfId = useMemo(() => {
    if (dashboardData === null) {
      return {};
    }

    return createThreadOfId(dashboardData.threads);
  }, [dashboardData]);
  const selectedRepo = useMemo(() => {
    if (dashboardData === null || dashboardData.repos.length === 0) {
      return null;
    }

    if (selectedRepoRoot !== null) {
      const repo = dashboardData.repos.find(
        (dashboardRepo) => dashboardRepo.root === selectedRepoRoot,
      );

      if (repo !== undefined) {
        return repo;
      }
    }

    return dashboardData.repos[0] ?? null;
  }, [dashboardData, selectedRepoRoot]);
  const visibleErrorMessage = actionErrorMessage ?? dashboardErrorMessage;

  const refreshDashboard = useCallback(async () => {
    if (isDashboardRefreshRunningRef.current) {
      shouldRefreshDashboardAgainRef.current = true;

      if (dashboardRefreshPromiseRef.current !== null) {
        await dashboardRefreshPromiseRef.current;
      }

      return;
    }

    const dashboardRefreshPromise = (async () => {
      isDashboardRefreshRunningRef.current = true;
      setIsLoading(true);

      try {
        do {
          shouldRefreshDashboardAgainRef.current = false;

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
              setDashboardErrorMessage(nextDashboardData.gitErrors.join("\n"));
            } else {
              setDashboardErrorMessage(null);
            }
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to read dashboard data.";
            setSuccessMessage(null);
            setDashboardErrorMessage(message);
          }
        } while (shouldRefreshDashboardAgainRef.current);
      } finally {
        isDashboardRefreshRunningRef.current = false;
        dashboardRefreshPromiseRef.current = null;
        setIsLoading(false);
      }
    })();

    dashboardRefreshPromiseRef.current = dashboardRefreshPromise;
    await dashboardRefreshPromise;
  }, []);
  const showErrorMessage = useCallback((message: string) => {
    setSuccessMessage(null);
    setActionErrorMessage(message);
  }, []);
  const clearErrorMessage = useCallback(() => {
    setActionErrorMessage(null);
    setDashboardErrorMessage(null);
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
    if (dashboardData === null) {
      return;
    }

    if (dashboardData.repos.length === 0) {
      if (selectedRepoRoot !== null) {
        setSelectedRepoRoot(null);
      }

      return;
    }

    if (
      selectedRepoRoot !== null &&
      dashboardData.repos.some((repo) => repo.root === selectedRepoRoot)
    ) {
      return;
    }

    const firstRepo = dashboardData.repos[0];

    if (firstRepo !== undefined) {
      setSelectedRepoRoot(firstRepo.root);
    }
  }, [dashboardData, selectedRepoRoot]);

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
    const branchTagChangeActionText = readBranchTagChangeActionText(action);
    const changes = readVisibleBranchTagChangesForRepo(repoRoot);

    if (changes.length === 0) {
      closeBranchTagChangeModal();
      return;
    }

    closeBranchTagChangeModal();
    let gitErrorMessage: string | null = null;

    try {
      switch (action) {
        case "push":
          await window.molttree.pushGitBranchTagChanges(changes);
          break;
        case "pull":
          await window.molttree.resetGitBranchTagChanges(changes);
          break;
        case "reset":
          await window.molttree.resetGitBranchTagChanges(changes);
          break;
      }

      setBranchTagChanges((currentBranchTagChanges) =>
        currentBranchTagChanges.filter(
          (branchTagChange) => branchTagChange.repoRoot !== repoRoot,
        ),
      );
      setActionErrorMessage(null);
      setSuccessMessage(branchTagChangeActionText.successMessage);
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
  const branchTagChangeActionText =
    branchTagChangeConfirmation === null
      ? null
      : readBranchTagChangeActionText(branchTagChangeConfirmation.action);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>MoltTree</h1>
          <p>
            {dashboardData === null
              ? "Loading"
              : `${dashboardData.repos.length} repos`}
          </p>
        </div>
        <div className="toolbar">
          {dashboardData === null || dashboardData.repos.length === 0 ? null : (
            <Label className="repo-picker">
              <span>Repo</span>
              <NativeSelect
                className="min-w-0 flex-1"
                value={selectedRepo?.root ?? ""}
                onChange={(event) => setSelectedRepoRoot(event.target.value)}
              >
                {dashboardData.repos.map((repo) => (
                  <NativeSelectOption value={repo.root} key={repo.root}>
                    {readRepoFolderName(repo)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          )}
        </div>
      </header>

      <AlertDialog
        open={branchTagChangeConfirmation !== null}
        onOpenChange={(isOpen) => {
          if (isOpen) {
            return;
          }

          closeBranchTagChangeModal();
        }}
      >
        {branchTagChangeConfirmation === null ? null : (
          <AlertDialogContent className="branch-tag-change-modal sm:max-w-[520px]">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {branchTagChangeActionText?.title}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {branchTagChangeActionText?.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="branch-tag-change-list">
              {branchTagChangesInConfirmation.map((branchTagChange) => (
                <li
                  key={`${branchTagChange.repoRoot}:${branchTagChange.branch}`}
                >
                  <strong>{branchTagChange.branch}</strong>
                  <code>
                    {branchTagChange.newSha === null
                      ? `${branchTagChange.oldSha.slice(0, 7)} -> deleted`
                      : `${branchTagChange.oldSha.slice(0, 7)} -> ${branchTagChange.newSha.slice(0, 7)}`}
                  </code>
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={closeBranchTagChangeModal}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={confirmBranchTagChanges}>
                {branchTagChangeActionText?.buttonText}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      {visibleErrorMessage !== null && (
        <Alert className="error-banner" variant="destructive">
          <AlertDescription>{visibleErrorMessage}</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearErrorMessage}
            >
              Dismiss
            </Button>
          </AlertAction>
        </Alert>
      )}

      {successMessage !== null && (
        <Alert className="success-banner">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      {dashboardData !== null && dashboardData.warnings.length > 0 && (
        <Alert className="warning-band">
          {dashboardData.warnings.map((warning) => (
            <AlertDescription key={warning}>{warning}</AlertDescription>
          ))}
        </Alert>
      )}

      <div className="content-shell">
        <div className="repo-list">
          {selectedRepo === null ? null : (
            <RepoSection
              key={selectedRepo.key}
              repo={selectedRepo}
              threadOfId={threadOfId}
              gitChangesOfCwd={dashboardData?.gitChangesOfCwd ?? {}}
              repoBranchTagChanges={readVisibleBranchTagChangesForRepo(
                selectedRepo.root,
              )}
              refreshDashboard={refreshDashboard}
              showErrorMessage={showErrorMessage}
              rememberBranchTagChange={rememberBranchTagChange}
              openBranchTagChangeModal={openBranchTagChangeModal}
            />
          )}
          {dashboardData !== null &&
            dashboardData.repos.length === 0 &&
            !isLoading && (
              <Empty className="empty-state">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <GitCommitHorizontal size={22} />
                  </EmptyMedia>
                  <EmptyDescription>
                    No Git repos found from Codex thread working directories.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
        </div>
      </div>
    </main>
  );
};
