import {
  CircleArrowDown,
  CircleArrowLeft,
  CircleArrowUp,
  Info,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { GoDotFill } from "react-icons/go";
import {
  LuCheck,
  LuGitBranchPlus,
  LuGitCommitHorizontal,
  LuGitPullRequestArrow,
} from "react-icons/lu";
import { MdOutlineCallSplit } from "react-icons/md";
import { VscVscode } from "react-icons/vsc";
import { Resizable } from "react-resizable";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DragEvent,
  FormEvent,
  MouseEvent,
  PointerEvent,
  ReactElement,
} from "react";
import type { ResizeCallbackData } from "react-resizable";
import type {
  CodexThread,
  DashboardData,
  GitBranchTagChange,
  GitChangeSummary,
  GitCommit,
  GitMergePreview,
  GitWorktree,
  PathLauncher,
  RepoGraph,
} from "../shared/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import cursorAppIconUrl from "./assets/cursor-app-icon.png";
import finderAppIconUrl from "./assets/finder-app-icon.png";
import initialLoadingImageUrl from "./assets/initial-loading.png";
import {
  readDisplayedThreadGroups,
  readIsGitChangeSummaryEmpty,
  readIsWorktreeCwd,
} from "./threadGroups";
import type { ThreadGroup } from "./threadGroups";
import packageInfo from "../../package.json";

// The history view is a SourceTree-style row table. Git owns the commits; the renderer only assigns lanes.
// TODO: AI-PICKED-VALUE: These graph sizes and colors are initial SourceTree-like choices for dense commit rows.
const COMMIT_GRAPH_ROW_HEIGHT = 20;
const COMMIT_GRAPH_LANE_WIDTH = 14;
const COMMIT_GRAPH_PADDING_LEFT = 16;
const COMMIT_GRAPH_MIN_WIDTH = 96;
const COMMIT_GRAPH_DOT_RADIUS = 4;
// TODO: AI-PICKED-VALUE: This slightly larger outer dot makes the HEAD commit distinct without adding another icon.
const COMMIT_GRAPH_HEAD_DOT_RADIUS = 4.75;
// TODO: AI-PICKED-VALUE: This center dot makes the HEAD commit distinct without hiding the commit color.
const COMMIT_GRAPH_HEAD_CENTER_DOT_RADIUS = 2.25;
// TODO: AI-PICKED-VALUE: This keeps graph lines readable in compact rows while making them less heavy.
const COMMIT_GRAPH_SEGMENT_STROKE_WIDTH = 2.25;
// TODO: AI-PICKED-VALUE: This neutral gray makes changed cwd rows read as working-tree state instead of Git history.
const COMMIT_GRAPH_CWD_CHANGE_COLOR = "#8b929c";
const COMMIT_GRAPH_ROW_CONNECTION_INSET_RATIO = 0;
const COMMIT_HISTORY_HEADER_HEIGHT = 22;
// Dashboard reads touch Codex and Git, so automatic refreshes share the manual refresh path and never overlap.
// TODO: AI-PICKED-VALUE: Refreshing every second keeps branch/worktree state current while the refresh queue prevents overlapping Git reads.
const DASHBOARD_REFRESH_INTERVAL_MS = 1000;
// TODO: AI-PICKED-VALUE: One second is long enough for success confirmations that do not need manual dismissal.
const SUCCESS_MESSAGE_TIMEOUT_MS = 1000;
const TOAST_POSITION = "top-center";
const USER_GIT_UPDATE_TOAST_ID = "user-git-update";
const MERGE_BRANCH_BUTTON_TITLE = "Merge this into HEAD";
const COMMIT_GRAPH_ACTION_ICON_SIZE = 10;
// TODO: AI-PICKED-VALUE: A light stroke makes the graph actions read as buttons instead of status markers.
const COMMIT_GRAPH_ACTION_ICON_STROKE_WIDTH = 2;
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

const readCreatedBranchName = (branchName: string) => {
  return branchName.trim().replace(/[^A-Za-z0-9._/-]+/g, "-");
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

  // Dashboard branch changes are the source of truth; this state only keeps user actions alive while a Git refresh is still catching up.
  for (const repo of dashboardData.repos) {
    const branchTagChangeOfBranch: {
      [branch: string]: GitBranchTagChange;
    } = {};
    branchTagChangeOfBranchOfRepo[repo.root] = branchTagChangeOfBranch;

    for (const branchTagChange of repo.branchTagChanges) {
      branchTagChangeOfBranch[branchTagChange.branch] = branchTagChange;
    }
  }

  for (const branchTagChange of branchTagChanges) {
    const branchTagChangeOfBranch =
      branchTagChangeOfBranchOfRepo[branchTagChange.repoRoot];

    if (branchTagChangeOfBranch === undefined) {
      continue;
    }

    const repoBranchTagChange = branchTagChangeOfBranch[branchTagChange.branch];

    if (repoBranchTagChange === undefined) {
      continue;
    }

    if (repoBranchTagChange.newSha === branchTagChange.oldSha) {
      nextBranchTagChanges.push(branchTagChange);
    }
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
        loadingDescription: "Pushing branch tags",
        successMessage: "Branch tag changes pushed.",
      };
    case "pull":
      return {
        title: "Pull Branch Tag Changes",
        message:
          "Are you sure you want to pull branch tag changes from origin for this repo?",
        buttonText: "Pull",
        loadingDescription: "Pulling branch tags",
        successMessage: "Branch tag changes pulled.",
      };
    case "reset":
      return {
        title: "Revert Branch Tag Changes",
        message:
          "Are you sure you want to revert branch tag changes for this repo to match origin?",
        buttonText: "Revert",
        loadingDescription: "Reverting branch tags",
        successMessage: "Branch tag changes reverted.",
      };
  }
};

const TitleTooltip = ({
  title,
  children,
}: {
  title: string;
  children: ReactElement;
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <p>{title}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const readPathLauncher = (value: string): PathLauncher | null => {
  switch (value) {
    case "vscode":
      return "vscode";
    case "cursor":
      return "cursor";
    case "finder":
      return "finder";
    default:
      return null;
  }
};

const PathLauncherIcon = ({ pathLauncher }: { pathLauncher: PathLauncher }) => {
  switch (pathLauncher) {
    case "vscode":
      return (
        <span className="path-launcher-icon path-launcher-icon-vscode">
          <VscVscode aria-hidden="true" className="text-current" size={20} />
        </span>
      );
    case "cursor":
      return (
        <span className="path-launcher-icon path-launcher-icon-cursor">
          <img
            alt=""
            aria-hidden="true"
            className="path-launcher-icon-image"
            draggable={false}
            src={cursorAppIconUrl}
          />
        </span>
      );
    case "finder":
      return (
        <span className="path-launcher-icon path-launcher-icon-finder">
          <img
            alt=""
            aria-hidden="true"
            className="path-launcher-icon-image"
            draggable={false}
            src={finderAppIconUrl}
          />
        </span>
      );
  }
};

const PathLauncherSelectItems = () => {
  return (
    <>
      <SelectItem value="vscode">
        <span className="path-launcher-option">
          <PathLauncherIcon pathLauncher="vscode" />
          <span>VS Code</span>
        </span>
      </SelectItem>
      <SelectItem value="cursor">
        <span className="path-launcher-option">
          <PathLauncherIcon pathLauncher="cursor" />
          <span>Cursor</span>
        </span>
      </SelectItem>
      <SelectItem value="finder">
        <span className="path-launcher-option">
          <PathLauncherIcon pathLauncher="finder" />
          <span>Finder</span>
        </span>
      </SelectItem>
    </>
  );
};

const copyTextAfterContextMenu = async ({
  event,
  text,
  errorMessage,
}: {
  event: MouseEvent<Element>;
  text: string;
  errorMessage: string;
}) => {
  event.preventDefault();
  event.stopPropagation();

  try {
    await window.molttree.copyText(text);
    toast.success("Copied!", {
      closeButton: false,
      description: <div className="copy-toast-value">{text}</div>,
      duration: SUCCESS_MESSAGE_TIMEOUT_MS,
      position: TOAST_POSITION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : errorMessage;
    toast.error("Error", {
      description: message,
      position: TOAST_POSITION,
    });
  }
};

const readRepoFolderName = (repo: RepoGraph) => {
  return repo.root.split("/").pop() ?? repo.root;
};

// TODO: AI-PICKED-VALUE: These column widths match the current table layout closely enough while making drag resizing concrete.
const COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS = {
  graph: 140,
  branchTags: 408,
  codeLocations: 160,
  actors: 480,
  description: 294,
  commit: 84,
  author: 150,
  date: 170,
};
// TODO: AI-PICKED-VALUE: These smaller resize limits keep columns usable while allowing the page to compress much further.
const COMMIT_HISTORY_MIN_COLUMN_WIDTHS = {
  branchTags: 120,
  codeLocations: 96,
  actors: 44,
  description: 120,
  commit: 52,
  author: 64,
  date: 82,
};
const COMMIT_HISTORY_MIN_DETAILS_WIDTH =
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.actors +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.branchTags +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.codeLocations +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.description +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.commit +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.author +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.date;

type CommitHistoryColumnKey =
  | "branchTags"
  | "codeLocations"
  | "actors"
  | "description"
  | "commit"
  | "author"
  | "date";

type CommitHistoryColumnWidths = {
  graph: number;
  branchTags: number;
  codeLocations: number;
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
  sourcePath: string | null;
  branch: string;
  oldSha: string;
  oldShortSha: string;
  oldSubject: string;
};

type BranchPointerMove = {
  repoRoot: string;
  sourcePath: string | null;
  targetPath: string | null;
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
  loadingDescription: string;
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
  threadGroup: ThreadGroup | null;
  isCommitRow: boolean;
  lane: number;
  color: string;
  rowIndex: number;
};

type CommitGraphItem = {
  id: string;
  commit: GitCommit;
  sha: string;
  parents: string[];
  threadIds: string[];
  changedThreadGroups: ThreadGroup[];
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
  color: string;
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
  return `${columnWidths.graph}px ${columnWidths.actors}px ${columnWidths.branchTags}px ${columnWidths.codeLocations}px ${columnWidths.description}px ${columnWidths.commit}px ${columnWidths.author}px ${columnWidths.date}px`;
};

const readCommitHistoryTableWidth = (
  columnWidths: CommitHistoryColumnWidths,
) => {
  return (
    columnWidths.graph +
    columnWidths.branchTags +
    columnWidths.codeLocations +
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
    case "branchTags":
      return { ...columnWidths, branchTags: width };
    case "codeLocations":
      return { ...columnWidths, codeLocations: width };
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

const createCommitGraph = ({
  commits,
  threadOfId,
  worktrees,
  gitChangesOfCwd,
}: {
  commits: GitCommit[];
  threadOfId: { [id: string]: CodexThread };
  worktrees: GitWorktree[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
}) => {
  const graphItems: CommitGraphItem[] = [];
  const commitOfSha: { [sha: string]: GitCommit } = {};
  const firstParentChildCountOfSha: { [sha: string]: number } = {};
  const colorIndexOfSha: { [sha: string]: number } = {};
  const lanes: CommitGraphLane[] = [];
  const rows: CommitGraphRow[] = [];
  const segments: CommitGraphSegment[] = [];
  const isSegmentAddedOfKey: { [key: string]: boolean } = {};
  let laneCount = 1;

  for (const commit of commits) {
    commitOfSha[commit.sha] = commit;
    const firstParent = commit.parents[0];

    if (firstParent !== undefined) {
      firstParentChildCountOfSha[firstParent] =
        (firstParentChildCountOfSha[firstParent] ?? 0) + 1;
    }
  }

  let headSha: string | null = null;

  for (const commit of commits) {
    if (commit.refs.some((ref) => readIsHeadRef(ref))) {
      headSha = commit.sha;
      break;
    }
  }

  const displayedThreadIdsOfSha: { [sha: string]: string[] } = {};

  for (const commit of commits) {
    displayedThreadIdsOfSha[commit.sha] = [];
  }

  for (const commit of commits) {
    for (const threadId of commit.threadIds) {
      const thread = threadOfId[threadId];

      if (thread === undefined) {
        continue;
      }

      const displaySha =
        headSha !== null && !readIsWorktreeCwd({ cwd: thread.cwd, worktrees })
          ? headSha
          : commit.sha;
      const displayedThreadIds = displayedThreadIdsOfSha[displaySha];

      if (displayedThreadIds === undefined) {
        continue;
      }

      displayedThreadIds.push(thread.id);
    }
  }

  const readIsThreadGroupChanged = (threadGroup: ThreadGroup) => {
    const gitChangeSummary = gitChangesOfCwd[threadGroup.cwd];

    return (
      gitChangeSummary !== undefined &&
      !readIsGitChangeSummaryEmpty(gitChangeSummary)
    );
  };

  const readEarliestLaneColorSeedSha = ({ sha }: { sha: string }) => {
    const isSeenSha: { [sha: string]: boolean } = {};
    let colorSeedSha = sha;

    // Use the oldest visible commit in this first-parent line segment, so newer commits do not repaint the lane.
    while (true) {
      const commit = commitOfSha[colorSeedSha];
      const firstParent = commit?.parents[0];

      if (firstParent === undefined || isSeenSha[firstParent] === true) {
        return colorSeedSha;
      }

      if ((firstParentChildCountOfSha[firstParent] ?? 0) > 1) {
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
    const colorSeedSha = readEarliestLaneColorSeedSha({ sha });
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
    const commitThreadIds = displayedThreadIdsOfSha[commit.sha] ?? [];
    const threads = commitThreadIds
      .map((threadId) => threadOfId[threadId])
      .filter((thread): thread is CodexThread => thread !== undefined);
    const threadGroups = readDisplayedThreadGroups({
      threads,
      worktrees,
      gitChangesOfCwd,
    });
    const changedThreadGroups: ThreadGroup[] = [];
    const unchangedThreadIds: string[] = [];

    for (const threadGroup of threadGroups) {
      if (readIsThreadGroupChanged(threadGroup)) {
        changedThreadGroups.push(threadGroup);
        continue;
      }

      for (const thread of threadGroup.threads) {
        unchangedThreadIds.push(thread.id);
      }
    }

    graphItems.push({
      id: `commit:${commit.sha}`,
      commit,
      sha: commit.sha,
      parents: commit.parents,
      threadIds: unchangedThreadIds,
      changedThreadGroups,
    });
  }

  const addSegment = ({
    fromLane,
    toLane,
    fromRowIndex,
    toRowIndex,
    color,
    isMergeSegment,
  }: CommitGraphSegment) => {
    const key = `${fromLane}:${toLane}:${fromRowIndex}:${toRowIndex}:${color}:${isMergeSegment}`;

    if (isSegmentAddedOfKey[key] === true) {
      return;
    }

    isSegmentAddedOfKey[key] = true;
    segments.push({
      fromLane,
      toLane,
      fromRowIndex,
      toRowIndex,
      color,
      isMergeSegment,
    });
  };

  const addPassthroughSegmentsForThreadGroupRow = ({
    rowIndex,
    skippedLane,
  }: {
    rowIndex: number;
    skippedLane: number | null;
  }) => {
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const laneItem = lanes[laneIndex];

      if (laneIndex === skippedLane) {
        continue;
      }

      addSegment({
        fromLane: laneIndex,
        toLane: laneIndex,
        fromRowIndex: rowIndex,
        toRowIndex: rowIndex + 1,
        color: readCommitGraphColor(laneItem.colorIndex),
        isMergeSegment: false,
      });
    }
  };

  // Changed cwd groups become their own graph rows because they represent working-tree state above their base commit.
  for (const graphItem of graphItems) {
    let lane = lanes.findIndex((laneItem) => laneItem.sha === graphItem.sha);
    const shouldShowCommitLaneThroughChangedThreadGroups = lane !== -1;

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
    for (
      let threadGroupIndex = 0;
      threadGroupIndex < graphItem.changedThreadGroups.length;
      threadGroupIndex += 1
    ) {
      const threadGroup = graphItem.changedThreadGroups[threadGroupIndex];
      const rowIndex = rows.length;
      const threadGroupLane = lanes.length + threadGroupIndex;
      const skippedPassthroughLane =
        shouldShowCommitLaneThroughChangedThreadGroups || threadGroupIndex > 0
          ? null
          : lane;
      rows.push({
        id: `${graphItem.id}:thread-group:${threadGroup.key}`,
        commit: graphItem.commit,
        threadIds: threadGroup.threads.map((thread) => thread.id),
        threadGroup,
        isCommitRow: false,
        lane: threadGroupLane,
        color: COMMIT_GRAPH_CWD_CHANGE_COLOR,
        rowIndex,
      });
      addPassthroughSegmentsForThreadGroupRow({
        rowIndex,
        skippedLane: skippedPassthroughLane,
      });
      addSegment({
        fromLane: threadGroupLane,
        toLane: lane,
        fromRowIndex: rowIndex,
        toRowIndex: rowIndex + 1,
        color: readCommitGraphColor(commitLane.colorIndex),
        isMergeSegment: false,
      });
      laneCount = Math.max(
        laneCount,
        lanes.length + graphItem.changedThreadGroups.length,
      );
    }

    const rowIndex = rows.length;
    rows.push({
      id: graphItem.id,
      commit: graphItem.commit,
      threadIds: graphItem.threadIds,
      threadGroup: null,
      isCommitRow: true,
      lane,
      color: readCommitGraphColor(commitLane.colorIndex),
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
        color: readCommitGraphColor(laneItem.colorIndex),
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
        color: readCommitGraphColor(
          parentColorIndex === undefined
            ? commitLane.colorIndex
            : parentColorIndex,
        ),
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

const readIsCwdInsidePath = ({ cwd, path }: { cwd: string; path: string }) => {
  return cwd === path || cwd.startsWith(`${path}/`);
};

const readBranchPointerRowPath = ({
  row,
  repoRoot,
  worktrees,
}: {
  row: CommitGraphRow;
  repoRoot: string;
  worktrees: GitWorktree[];
}) => {
  if (row.threadGroup === null || row.threadGroup.cwd.length === 0) {
    return null;
  }

  for (const worktree of worktrees) {
    if (
      readIsCwdInsidePath({ cwd: row.threadGroup.cwd, path: worktree.path })
    ) {
      return worktree.path;
    }
  }

  if (readIsCwdInsidePath({ cwd: row.threadGroup.cwd, path: repoRoot })) {
    return repoRoot;
  }

  return row.threadGroup.cwd;
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
  localBranches,
  currentBranch,
  defaultBranch,
  commitSha,
  commitShortSha,
  commitSubject,
  branchPointerSourcePath,
  isBranchDeleteSafeOfBranch,
  openBranchDeleteModal,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  refs: string[];
  localBranches: string[];
  currentBranch: string | null;
  defaultBranch: string | null;
  commitSha: string;
  commitShortSha: string;
  commitSubject: string;
  branchPointerSourcePath: string | null;
  isBranchDeleteSafeOfBranch: { [branch: string]: boolean };
  openBranchDeleteModal: (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
    oldSha: string,
  ) => void;
  startBranchPointerDrag: ({
    event,
    sourcePath,
    branch,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    sourcePath: string | null;
    branch: string;
    oldSha: string;
    oldShortSha: string;
    oldSubject: string;
  }) => void;
  finishBranchPointerDrag: () => void;
}) => {
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

  if (orderedRefs.length === 0) {
    return null;
  }

  return (
    <div className="commit-label-list">
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
            draggable={isLocalBranch}
            key={ref}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              void copyTextAfterContextMenu({
                event,
                text: refName,
                errorMessage: "Failed to copy branch name.",
              });
            }}
            onDragStart={(event) => {
              if (!isLocalBranch) {
                return;
              }

              startBranchPointerDrag({
                event,
                sourcePath: branchPointerSourcePath,
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
              <TitleTooltip title={`Delete ${refName}`}>
                <Button
                  className="commit-ref-delete"
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  draggable={false}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    openBranchDeleteModal(event, refName, commitSha)
                  }
                >
                  <Trash2 size={9} />
                </Button>
              </TitleTooltip>
            ) : null}
          </Badge>
        );
      })}
    </div>
  );
};

const CodeLocations = ({
  refs,
  worktreesForRow,
  mainWorktreePath,
  openCodePath,
}: {
  refs: string[];
  worktreesForRow: GitWorktree[];
  mainWorktreePath: string;
  openCodePath: (path: string) => Promise<void>;
}) => {
  const hasHead = refs.some((ref) => readIsHeadRef(ref));

  if (!hasHead && worktreesForRow.length === 0) {
    return null;
  }

  return (
    <div className="commit-label-list">
      {hasHead ? (
        <Badge
          asChild
          className="commit-ref commit-ref-head commit-ref-clickable"
          variant="secondary"
        >
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              void copyTextAfterContextMenu({
                event,
                text: mainWorktreePath,
                errorMessage: "Failed to copy path.",
              });
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void openCodePath(mainWorktreePath);
            }}
          >
            <span>HEAD</span>
          </Button>
        </Badge>
      ) : null}
      {worktreesForRow.map((worktree) => (
        <Badge
          asChild
          className="commit-ref commit-ref-head commit-ref-clickable commit-ref-worktree"
          variant="secondary"
          key={worktree.path}
        >
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              void copyTextAfterContextMenu({
                event,
                text: worktree.path,
                errorMessage: "Failed to copy path.",
              });
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void openCodePath(worktree.path);
            }}
          >
            <MdOutlineCallSplit
              aria-hidden="true"
              className="commit-ref-worktree-icon"
              size={10}
            />
            <span>Worktree</span>
          </Button>
        </Badge>
      ))}
    </div>
  );
};

const ChatRobotTags = ({
  threadGroups,
  worktrees,
  showErrorMessage,
}: {
  threadGroups: ThreadGroup[];
  worktrees: GitWorktree[];
  showErrorMessage: (message: string) => void;
}) => {
  if (threadGroups.length === 0) {
    return null;
  }

  const openThread = async (threadId: string) => {
    try {
      await window.molttree.openCodexThread(threadId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open chat.";
      showErrorMessage(message);
    }
  };

  return (
    <div className="commit-label-list commit-thread-group-list">
      {threadGroups.map((threadGroup) => {
        const isThreadGroupWorktree = readIsWorktreeCwd({
          cwd: threadGroup.cwd,
          worktrees,
        });

        return (
          <span className="commit-thread-group" key={threadGroup.key}>
            {threadGroup.threads.map((thread) => {
              const title = threadTitle(thread);
              const isThreadActive = readIsThreadActive(thread);

              return (
                <Button
                  aria-label={
                    isThreadActive ? `${title} is loading` : `Open ${title}`
                  }
                  className="commit-thread-chat"
                  variant="ghost"
                  size="xs"
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
                  <span className="commit-thread-chat-title">{title}</span>
                  {isThreadGroupWorktree ? (
                    <MdOutlineCallSplit
                      aria-hidden="true"
                      className="commit-thread-chat-icon commit-ref-worktree-icon"
                      size={10}
                    />
                  ) : null}
                  {isThreadActive ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="commit-thread-chat-loading-icon"
                      size={10}
                    />
                  ) : isThreadGroupWorktree ? null : (
                    <GoDotFill
                      aria-hidden="true"
                      className="commit-thread-chat-icon"
                      size={9}
                    />
                  )}
                </Button>
              );
            })}
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
            key={`${segment.fromRowIndex}-${segment.toRowIndex}-${segment.fromLane}-${segment.toLane}-${segment.color}-${segment.isMergeSegment}`}
            d={path}
            fill="none"
            stroke={segment.color}
            strokeWidth={COMMIT_GRAPH_SEGMENT_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {graph.rows.map((row) => {
        const centerX = readCommitGraphX(row.lane);
        const centerY = readCommitGraphY(row.rowIndex);
        const isHeadRow =
          row.isCommitRow && row.commit.refs.some((ref) => readIsHeadRef(ref));

        return (
          <g key={row.id}>
            <circle
              cx={centerX}
              cy={centerY}
              r={
                isHeadRow
                  ? COMMIT_GRAPH_HEAD_DOT_RADIUS
                  : COMMIT_GRAPH_DOT_RADIUS
              }
              fill={row.color}
            />
            {isHeadRow ? (
              <circle
                cx={centerX}
                cy={centerY}
                r={COMMIT_GRAPH_HEAD_CENTER_DOT_RADIUS}
                fill="#ffffff"
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
  mainWorktreePath,
  worktrees,
  currentBranch,
  defaultBranch,
  isHeadClean,
  threadOfId,
  gitChangesOfCwd,
  isBranchPointerDropTarget,
  shouldOwnMainWorktreeHead,
  isBranchMergeableOfBranch,
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
  showErrorMessage,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  row: CommitGraphRow;
  repoRoot: string;
  mainWorktreePath: string;
  worktrees: GitWorktree[];
  currentBranch: string | null;
  defaultBranch: string | null;
  isHeadClean: boolean;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  isBranchPointerDropTarget: boolean;
  shouldOwnMainWorktreeHead: boolean;
  isBranchMergeableOfBranch: { [branch: string]: boolean };
  isBranchDeleteSafeOfBranch: { [branch: string]: boolean };
  updateBranchPointerDropTarget: (event: DragEvent<HTMLDivElement>) => void;
  clearBranchPointerDropTarget: (event: DragEvent<HTMLDivElement>) => void;
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
  showErrorMessage: (message: string) => void;
  startBranchPointerDrag: ({
    event,
    sourcePath,
    branch,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    sourcePath: string | null;
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
  const threadGroups =
    row.threadGroup === null
      ? readDisplayedThreadGroups({
          threads,
          worktrees,
          gitChangesOfCwd,
        })
      : [row.threadGroup];
  const rowThreadIdOfId: { [threadId: string]: boolean } = {};

  for (const rowThreadId of row.threadIds) {
    rowThreadIdOfId[rowThreadId] = true;
  }

  // One dirty row for the main worktree owns HEAD and the checked-out branch instead of duplicating them on the base commit row.
  const isMainWorktreeThreadGroupRow =
    row.threadGroup !== null &&
    row.threadGroup.cwd.length > 0 &&
    readIsCwdInsidePath({
      cwd: row.threadGroup.cwd,
      path: mainWorktreePath,
    }) &&
    !readIsWorktreeCwd({ cwd: row.threadGroup.cwd, worktrees });
  const worktreesForRow = worktrees.filter((worktree) => {
    if (worktree.head !== commit.sha) {
      return false;
    }

    if (row.threadGroup !== null) {
      if (
        readIsCwdInsidePath({
          cwd: row.threadGroup.cwd,
          path: worktree.path,
        })
      ) {
        return true;
      }

      for (const thread of row.threadGroup.threads) {
        if (worktree.threadIds.includes(thread.id)) {
          return true;
        }
      }

      return false;
    }

    for (const worktreeThreadId of worktree.threadIds) {
      if (rowThreadIdOfId[worktreeThreadId] !== true) {
        return false;
      }
    }

    return true;
  });
  const rowWorktreePathOfPath: { [path: string]: boolean } = {};
  const excludedLocalBranchOfName: { [branch: string]: boolean } = {};
  const rowLocalBranches: string[] = [];
  const isRowLocalBranchAddedOfBranch: { [branch: string]: boolean } = {};
  let hasChangedMainWorktreeThreadGroup = false;

  const pushRowLocalBranch = (branch: string) => {
    if (isRowLocalBranchAddedOfBranch[branch] === true) {
      return;
    }

    isRowLocalBranchAddedOfBranch[branch] = true;
    rowLocalBranches.push(branch);
  };

  for (const worktree of worktreesForRow) {
    rowWorktreePathOfPath[worktree.path] = true;
  }

  for (const worktree of worktrees) {
    if (
      worktree.head !== commit.sha ||
      worktree.branch === null ||
      rowWorktreePathOfPath[worktree.path] === true
    ) {
      continue;
    }

    excludedLocalBranchOfName[worktree.branch] = true;
  }

  if (row.threadGroup === null) {
    for (const commitThreadId of commit.threadIds) {
      const thread = threadOfId[commitThreadId];

      if (thread === undefined) {
        continue;
      }

      const gitChangeSummary = gitChangesOfCwd[thread.cwd];

      if (
        !hasChangedMainWorktreeThreadGroup &&
        thread.cwd.length > 0 &&
        gitChangeSummary !== undefined &&
        !readIsGitChangeSummaryEmpty(gitChangeSummary) &&
        readIsCwdInsidePath({ cwd: thread.cwd, path: mainWorktreePath }) &&
        !readIsWorktreeCwd({ cwd: thread.cwd, worktrees })
      ) {
        hasChangedMainWorktreeThreadGroup = true;
      }

      if (rowThreadIdOfId[commitThreadId] === true) {
        continue;
      }

      const threadBranch = thread.gitInfo?.branch ?? null;

      if (
        threadBranch !== null &&
        readIsLocalBranch({
          branch: threadBranch,
          localBranches: commit.localBranches,
        })
      ) {
        excludedLocalBranchOfName[threadBranch] = true;
      }
    }

    if (currentBranch !== null && hasChangedMainWorktreeThreadGroup) {
      excludedLocalBranchOfName[currentBranch] = true;
    }
  }

  if (row.threadGroup === null) {
    for (const localBranch of commit.localBranches) {
      if (excludedLocalBranchOfName[localBranch] === true) {
        continue;
      }

      pushRowLocalBranch(localBranch);
    }
  } else if (isMainWorktreeThreadGroupRow) {
    if (currentBranch !== null) {
      pushRowLocalBranch(currentBranch);
    }
  } else {
    for (const worktree of worktreesForRow) {
      if (worktree.branch !== null) {
        pushRowLocalBranch(worktree.branch);
      }
    }

    for (const thread of row.threadGroup.threads) {
      const threadBranch = thread.gitInfo?.branch ?? null;

      if (
        threadBranch !== null &&
        readIsLocalBranch({
          branch: threadBranch,
          localBranches: commit.localBranches,
        })
      ) {
        pushRowLocalBranch(threadBranch);
      }
    }

    if (
      currentBranch !== null &&
      worktreesForRow.length === 0 &&
      readIsCwdInsidePath({ cwd: row.threadGroup.cwd, path: repoRoot })
    ) {
      pushRowLocalBranch(currentBranch);
    }
  }

  const rowRefs =
    row.threadGroup === null
      ? commit.refs.filter((ref) => {
          const refName = cleanRefName(ref);

          if (hasChangedMainWorktreeThreadGroup && readIsHeadRef(ref)) {
            return false;
          }

          return (
            excludedLocalBranchOfName[refName] !== true ||
            !readIsLocalBranch({
              branch: refName,
              localBranches: commit.localBranches,
            })
          );
        })
      : isMainWorktreeThreadGroupRow
        ? shouldOwnMainWorktreeHead
          ? currentBranch === null
            ? ["HEAD"]
            : [`HEAD -> ${currentBranch}`]
          : []
        : rowLocalBranches;
  const rowCurrentBranch =
    row.threadGroup !== null && !isMainWorktreeThreadGroupRow
      ? (rowLocalBranches[0] ?? null)
      : currentBranch;
  const isHeadRow =
    row.isCommitRow && rowRefs.some((ref) => readIsHeadRef(ref));
  const actionThreadGroup = row.threadGroup;
  const storedActionChangeSummary =
    actionThreadGroup === null
      ? undefined
      : gitChangesOfCwd[actionThreadGroup.cwd];
  const actionChangeSummary =
    storedActionChangeSummary ?? EMPTY_GIT_CHANGE_SUMMARY;
  const actionTotalChangeSummary =
    readTotalGitChangeSummary(actionChangeSummary);
  const shouldShowActionChangeCount =
    storedActionChangeSummary !== undefined &&
    !readIsGitChangeSummaryEmpty(actionChangeSummary);
  const actionCommitBranchTarget =
    actionThreadGroup === null
      ? null
      : readCommitBranchTarget({
          cwd: actionThreadGroup.cwd,
          groupThreads: actionThreadGroup.threads,
          repoRoot,
          currentBranch: rowCurrentBranch,
          localBranches: rowLocalBranches,
          commitSha: commit.sha,
        });
  const shouldShowActionCommit =
    actionThreadGroup !== null &&
    actionThreadGroup.cwd.length > 0 &&
    shouldShowActionChangeCount &&
    actionCommitBranchTarget !== null;
  const shouldShowBranchCreateActions = rowLocalBranches.length === 0;
  const actionBranchCreateTarget =
    actionThreadGroup !== null &&
    shouldShowBranchCreateActions &&
    actionThreadGroup.cwd.length > 0 &&
    shouldShowActionChangeCount
      ? {
          path: actionThreadGroup.cwd,
          title: actionThreadGroup.cwd,
        }
      : null;
  const mergeBranch =
    !row.isCommitRow || isHeadRow
      ? null
      : (rowLocalBranches.find(
          (localBranch) =>
            localBranch !== currentBranch &&
            isBranchMergeableOfBranch[localBranch] === true,
        ) ?? null);
  let mergeDisabledReason: string | null = null;
  let rowClassName = "commit-history-row";

  if (mergeBranch !== null && isHeadClean === false) {
    mergeDisabledReason =
      "Current HEAD working tree must be clean before merging.";
  }

  const shouldShowGraphThreadActions =
    actionThreadGroup !== null && shouldShowActionChangeCount;
  const shouldShowGraphActions =
    shouldShowGraphThreadActions ||
    (row.isCommitRow && (mergeBranch !== null || isHeadRow));
  const commitDateText = formatCommitDate(commit.date);
  let branchTagsCellClassName = "commit-branch-tags-cell";

  if (isBranchPointerDropTarget) {
    rowClassName = `${rowClassName} commit-history-row-branch-drop-target`;
    branchTagsCellClassName = `${branchTagsCellClassName} commit-branch-tags-cell-branch-drop-target`;
  }

  const shouldShowCodeLocations =
    row.isCommitRow ||
    rowRefs.some((ref) => readIsHeadRef(ref)) ||
    worktreesForRow.length > 0;

  return (
    <div
      className={rowClassName}
      onDoubleClick={row.isCommitRow ? openRowAfterDoubleClick : undefined}
      onDragOver={updateBranchPointerDropTarget}
      onDragLeave={clearBranchPointerDropTarget}
      onDrop={finishBranchPointerDrop}
    >
      <div className="commit-graph-cell">
        {shouldShowGraphActions ? (
          <div className="commit-graph-actions">
            {shouldShowGraphThreadActions ? (
              <div className="commit-graph-thread-actions">
                <Button
                  className="commit-thread-change-count"
                  variant="ghost"
                  size="xs"
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    openChangeSummaryModal(event, {
                      path: actionThreadGroup.cwd,
                      title: actionThreadGroup.cwd,
                      changeSummary: actionChangeSummary,
                    })
                  }
                >
                  <span className="commit-thread-change-added">
                    +{actionTotalChangeSummary.added}
                  </span>
                  <span className="commit-thread-change-removed">
                    -{actionTotalChangeSummary.removed}
                  </span>
                </Button>
                {shouldShowActionCommit && actionCommitBranchTarget !== null ? (
                  <TitleTooltip title="Commit">
                    <Button
                      className="commit-thread-commit-action"
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={(event) =>
                        openCommitMessageModal(event, {
                          path: actionThreadGroup.cwd,
                          title: actionThreadGroup.cwd,
                          branchTarget: actionCommitBranchTarget,
                        })
                      }
                    >
                      <LuCheck
                        size={COMMIT_GRAPH_ACTION_ICON_SIZE}
                        strokeWidth={COMMIT_GRAPH_ACTION_ICON_STROKE_WIDTH}
                      />
                    </Button>
                  </TitleTooltip>
                ) : actionBranchCreateTarget === null ? null : (
                  <TitleTooltip title="Add branch tag here">
                    <Button
                      className="commit-branch-create-action"
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={(event) =>
                        openBranchCreateModal(event, actionBranchCreateTarget)
                      }
                    >
                      <LuGitBranchPlus
                        size={COMMIT_GRAPH_ACTION_ICON_SIZE}
                        strokeWidth={COMMIT_GRAPH_ACTION_ICON_STROKE_WIDTH}
                      />
                    </Button>
                  </TitleTooltip>
                )}
              </div>
            ) : null}
            {mergeBranch === null ? null : (
              <TitleTooltip
                title={
                  mergeDisabledReason === null
                    ? MERGE_BRANCH_BUTTON_TITLE
                    : mergeDisabledReason
                }
              >
                <span className="title-tooltip-trigger">
                  <Button
                    className="commit-graph-merge-action"
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={MERGE_BRANCH_BUTTON_TITLE}
                    disabled={mergeDisabledReason !== null}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) =>
                      openBranchMergeModal(event, mergeBranch)
                    }
                  >
                    <LuGitPullRequestArrow
                      size={COMMIT_GRAPH_ACTION_ICON_SIZE}
                      strokeWidth={COMMIT_GRAPH_ACTION_ICON_STROKE_WIDTH}
                    />
                  </Button>
                </span>
              </TitleTooltip>
            )}
          </div>
        ) : null}
      </div>
      <div className="commit-actors-cell">
        <ChatRobotTags
          threadGroups={threadGroups}
          worktrees={worktrees}
          showErrorMessage={showErrorMessage}
        />
      </div>
      <div className={branchTagsCellClassName}>
        {row.isCommitRow || rowRefs.length > 0 || worktreesForRow.length > 0 ? (
          <BranchTags
            refs={rowRefs}
            localBranches={rowLocalBranches}
            currentBranch={rowCurrentBranch}
            defaultBranch={defaultBranch}
            commitSha={commit.sha}
            commitShortSha={commit.shortSha}
            commitSubject={commit.subject}
            branchPointerSourcePath={readBranchPointerRowPath({
              row,
              repoRoot,
              worktrees,
            })}
            isBranchDeleteSafeOfBranch={isBranchDeleteSafeOfBranch}
            openBranchDeleteModal={openBranchDeleteModal}
            startBranchPointerDrag={startBranchPointerDrag}
            finishBranchPointerDrag={finishBranchPointerDrag}
          />
        ) : null}
      </div>
      <div className="commit-code-locations-cell">
        {shouldShowCodeLocations ? (
          <CodeLocations
            refs={rowRefs}
            worktreesForRow={worktreesForRow}
            mainWorktreePath={mainWorktreePath}
            openCodePath={openCodePath}
          />
        ) : null}
      </div>
      <div
        className="commit-description-cell"
        onContextMenu={
          row.isCommitRow
            ? (event) => {
                void copyTextAfterContextMenu({
                  event,
                  text: commit.subject,
                  errorMessage: "Failed to copy description.",
                });
              }
            : undefined
        }
      >
        {row.isCommitRow ? (
          <span className="commit-subject">{commit.subject}</span>
        ) : null}
      </div>
      <code
        className="commit-hash-cell"
        onContextMenu={
          row.isCommitRow
            ? (event) => {
                void copyTextAfterContextMenu({
                  event,
                  text: commit.sha,
                  errorMessage: "Failed to copy commit.",
                });
              }
            : undefined
        }
      >
        {row.isCommitRow ? commit.shortSha : null}
      </code>
      <div
        className="commit-author-cell"
        onContextMenu={
          row.isCommitRow
            ? (event) => {
                void copyTextAfterContextMenu({
                  event,
                  text: commit.author,
                  errorMessage: "Failed to copy author.",
                });
              }
            : undefined
        }
      >
        {row.isCommitRow ? commit.author : null}
      </div>
      <div
        className="commit-date-cell"
        onContextMenu={
          row.isCommitRow
            ? (event) => {
                void copyTextAfterContextMenu({
                  event,
                  text: commitDateText,
                  errorMessage: "Failed to copy date.",
                });
              }
            : undefined
        }
      >
        {row.isCommitRow ? commitDateText : null}
      </div>
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
  mainWorktreePath,
  currentBranch,
  defaultBranch,
  gitChangesOfCwd,
  pathLauncher,
  refreshDashboard,
  refreshDashboardAfterUserGitUpdate,
  runUserGitUpdate,
  showSuccessMessage,
  showErrorMessage,
  rememberBranchTagChange,
}: {
  commits: GitCommit[];
  worktrees: GitWorktree[];
  threadOfId: { [id: string]: CodexThread };
  repoRoot: string;
  mainWorktreePath: string;
  currentBranch: string | null;
  defaultBranch: string | null;
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  pathLauncher: PathLauncher;
  refreshDashboard: () => Promise<void>;
  refreshDashboardAfterUserGitUpdate: (
    finishUserGitUpdate: () => void,
  ) => Promise<boolean>;
  runUserGitUpdate: (
    userGitUpdateDescription: string,
    updateGit: (finishUserGitUpdate: () => void) => Promise<void>,
  ) => Promise<void>;
  showSuccessMessage: (message: string) => void;
  showErrorMessage: (message: string) => void;
  rememberBranchTagChange: (branchTagChange: GitBranchTagChange) => void;
}) => {
  const commitHistoryRef = useRef<HTMLDivElement | null>(null);
  const commitHistoryHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const columnResizeRef = useRef<CommitHistoryColumnResize | null>(null);
  const [columnWidths, setColumnWidths] = useState<CommitHistoryColumnWidths>(
    COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS,
  );
  const [shouldShowChatOnly, setShouldShowChatOnly] = useState(false);
  const branchPointerDragRef = useRef<BranchPointerDrag | null>(null);
  const [branchCreateTarget, setBranchCreateTarget] =
    useState<BranchCreateTarget | null>(null);
  const [branchName, setBranchName] = useState("");
  const createdBranchName = readCreatedBranchName(branchName);
  const shouldShowBranchNamePreview =
    branchName.trim().length > 0 && createdBranchName !== branchName.trim();
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
  const graph = useMemo(
    () =>
      createCommitGraph({
        commits,
        threadOfId,
        worktrees,
        gitChangesOfCwd,
      }),
    [commits, gitChangesOfCwd, threadOfId, worktrees],
  );
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
  const isBranchMergeableOfBranch = useMemo(() => {
    const commitOfSha: { [sha: string]: GitCommit } = {};
    const branchShaOfBranch: { [branch: string]: string } = {};
    const isShaReachableFromHead: { [sha: string]: boolean } = {};
    const nextIsBranchMergeableOfBranch: { [branch: string]: boolean } = {};
    let headSha: string | null = null;

    for (const commit of commits) {
      commitOfSha[commit.sha] = commit;

      if (commit.refs.some((ref) => readIsHeadRef(ref))) {
        headSha = commit.sha;
      }

      for (const localBranch of commit.localBranches) {
        branchShaOfBranch[localBranch] = commit.sha;
      }
    }

    if (headSha === null) {
      return nextIsBranchMergeableOfBranch;
    }

    const shasToRead = [headSha];

    while (shasToRead.length > 0) {
      const sha = shasToRead.pop();

      if (sha === undefined || isShaReachableFromHead[sha] === true) {
        continue;
      }

      isShaReachableFromHead[sha] = true;
      const commit = commitOfSha[sha];

      if (commit === undefined) {
        continue;
      }

      for (const parent of commit.parents) {
        shasToRead.push(parent);
      }
    }

    // A merge button is useful only when the branch tip is not already part of HEAD's reachable history.
    for (const branch of Object.keys(branchShaOfBranch)) {
      if (branch === currentBranch) {
        nextIsBranchMergeableOfBranch[branch] = false;
        continue;
      }

      nextIsBranchMergeableOfBranch[branch] =
        isShaReachableFromHead[branchShaOfBranch[branch]] !== true;
    }

    return nextIsBranchMergeableOfBranch;
  }, [commits, currentBranch]);
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
  const readBranchPointerTarget = ({ row }: { row: CommitGraphRow }) => {
    return {
      sha: row.commit.sha,
      shortSha: row.commit.shortSha,
      subject:
        row.threadGroup === null
          ? row.commit.subject
          : `Uncommitted changes in ${row.threadGroup.cwd}`,
      path: readBranchPointerRowPath({ row, repoRoot, worktrees }),
    };
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
  const mainWorktreeHeadOwnerRowId = useMemo(() => {
    for (const row of visibleGraph.rows) {
      if (
        row.threadGroup === null ||
        row.threadGroup.cwd.length === 0 ||
        !readIsCwdInsidePath({
          cwd: row.threadGroup.cwd,
          path: mainWorktreePath,
        }) ||
        readIsWorktreeCwd({ cwd: row.threadGroup.cwd, worktrees })
      ) {
        continue;
      }

      return row.id;
    }

    return null;
  }, [mainWorktreePath, visibleGraph.rows, worktrees]);

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
  const graphMaxWidth = Math.max(
    graphMinimumWidth,
    tableWidth - COMMIT_HISTORY_MIN_DETAILS_WIDTH,
  );

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
  const resizeGraphColumn = (data: ResizeCallbackData) => {
    if (!Number.isFinite(data.size.width)) {
      return;
    }

    const nextGraphWidth = Math.min(
      graphMaxWidth,
      Math.max(graphMinimumWidth, Math.round(data.size.width)),
    );

    setColumnWidths((currentColumnWidths) => {
      if (currentColumnWidths.graph === nextGraphWidth) {
        return currentColumnWidths;
      }

      return {
        ...currentColumnWidths,
        graph: nextGraphWidth,
      };
    });
  };
  const startBranchPointerDrag = ({
    event,
    sourcePath,
    branch,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    sourcePath: string | null;
    branch: string;
    oldSha: string;
    oldShortSha: string;
    oldSubject: string;
  }) => {
    const nextBranchPointerDrag = {
      repoRoot,
      sourcePath,
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

    const branchPointerTarget = readBranchPointerTarget({ row });
    const isSameBranchPointerPlace =
      activeBranchPointerDrag.oldSha === branchPointerTarget.sha &&
      activeBranchPointerDrag.sourcePath === branchPointerTarget.path;

    if (
      activeBranchPointerDrag.repoRoot !== repoRoot ||
      isSameBranchPointerPlace
    ) {
      setBranchPointerDropTargetRowId(null);
      return;
    }

    event.preventDefault();
    if (
      readIsBranchMoveSafe({
        branch: activeBranchPointerDrag.branch,
        oldSha: activeBranchPointerDrag.oldSha,
        newSha: branchPointerTarget.sha,
      })
    ) {
      event.dataTransfer.dropEffect = "move";
      setBranchPointerDropTargetRowId(row.id);
      return;
    }

    event.dataTransfer.dropEffect = "none";
    setBranchPointerDropTargetRowId(null);
  };
  const clearBranchPointerDropTarget = (event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;

    if (
      relatedTarget instanceof Node &&
      event.currentTarget.contains(relatedTarget)
    ) {
      return;
    }

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

    const branchPointerTarget = readBranchPointerTarget({ row });
    const isSameBranchPointerPlace =
      activeBranchPointerDrag.oldSha === branchPointerTarget.sha &&
      activeBranchPointerDrag.sourcePath === branchPointerTarget.path;

    if (
      activeBranchPointerDrag.repoRoot !== repoRoot ||
      isSameBranchPointerPlace
    ) {
      finishBranchPointerDrag();
      return;
    }

    if (
      !readIsBranchMoveSafe({
        branch: activeBranchPointerDrag.branch,
        oldSha: activeBranchPointerDrag.oldSha,
        newSha: branchPointerTarget.sha,
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
      sourcePath: activeBranchPointerDrag.sourcePath,
      targetPath: branchPointerTarget.path,
      branch: activeBranchPointerDrag.branch,
      oldSha: activeBranchPointerDrag.oldSha,
      oldShortSha: activeBranchPointerDrag.oldShortSha,
      oldSubject: activeBranchPointerDrag.oldSubject,
      newSha: branchPointerTarget.sha,
      newShortSha: branchPointerTarget.shortSha,
      newSubject: branchPointerTarget.subject,
      willMoveCheckedOutWorktree: readIsBranchCheckedOut(
        activeBranchPointerDrag.branch,
      ),
    });
    finishBranchPointerDrag();
  };
  // User Git updates keep the visible update status open until the dashboard read has shown the new Git state.
  const runUserGitUpdateThenRefreshDashboard = async (
    userGitUpdateDescription: string,
    successMessage: string,
    updateGit: () => Promise<string | null>,
  ) => {
    await runUserGitUpdate(
      userGitUpdateDescription,
      async (finishUserGitUpdate) => {
        const gitErrorMessage = await updateGit();
        const didRefreshDashboard =
          await refreshDashboardAfterUserGitUpdate(finishUserGitUpdate);

        if (gitErrorMessage !== null) {
          showErrorMessage(gitErrorMessage);
          return;
        }

        if (didRefreshDashboard) {
          showSuccessMessage(successMessage);
        }
      },
    );
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

    await runUserGitUpdateThenRefreshDashboard(
      "Creating branch",
      "Created branch.",
      async () => {
        try {
          await window.molttree.createGitBranch({
            path: request.path,
            branch: createdBranchName,
          });
          closeBranchCreateModal();
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to create branch.";
        }

        return null;
      },
    );
  };
  const submitCommitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (commitMessageTarget === null) {
      return;
    }

    const request = commitMessageTarget;

    await runUserGitUpdateThenRefreshDashboard(
      "Committing changes",
      "Committed changes.",
      async () => {
        try {
          const newSha = await window.molttree.commitAllGitChanges({
            path: request.path,
            message: commitMessage.trim(),
          });

          if (request.branchTarget !== null) {
            try {
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
            } catch {
              // The commit already succeeded, so a stale branch tag should not turn it into an error.
            }
          }

          closeCommitMessageModal();
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to commit changes.";
        }

        return null;
      },
    );
  };
  const deleteBranchTag = async () => {
    if (branchToDelete === null) {
      return;
    }

    const branchDeleteTarget = branchToDelete;
    closeBranchDeleteModal();

    await runUserGitUpdateThenRefreshDashboard(
      "Deleting branch",
      "Deleted branch.",
      async () => {
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
          return error instanceof Error
            ? error.message
            : "Failed to delete branch.";
        }

        return null;
      },
    );
  };
  const openCodePath = async (path: string) => {
    try {
      await window.molttree.openPath({ path, launcher: pathLauncher });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open path.";
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

    await runUserGitUpdateThenRefreshDashboard(
      "Merging branch",
      "Merged branch.",
      async () => {
        try {
          await window.molttree.mergeGitBranch({
            repoRoot,
            branch: request.branch,
          });
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to start merge.";
        }

        return null;
      },
    );
  };
  const moveBranchPointer = async () => {
    if (branchPointerMove === null) {
      return;
    }

    const request = branchPointerMove;
    closeBranchPointerMoveModal();

    const isDetachingBranchFromWorktree =
      request.sourcePath !== null &&
      request.targetPath === null &&
      request.oldSha === request.newSha;

    await runUserGitUpdateThenRefreshDashboard(
      request.targetPath === null ? "Moving branch" : "Switching branch",
      request.targetPath === null ? "Moved branch." : "Switched branch.",
      async () => {
        try {
          if (isDetachingBranchFromWorktree && request.sourcePath !== null) {
            await window.molttree.detachGitWorktreeBranch({
              repoRoot: request.repoRoot,
              path: request.sourcePath,
              branch: request.branch,
              sha: request.oldSha,
            });
          } else if (request.targetPath === null) {
            await window.molttree.moveGitBranch({
              repoRoot: request.repoRoot,
              branch: request.branch,
              oldSha: request.oldSha,
              newSha: request.newSha,
            });
          } else {
            await window.molttree.switchGitBranch({
              repoRoot: request.repoRoot,
              path: request.targetPath,
              branch: request.branch,
              oldSha: request.oldSha,
              newSha: request.newSha,
            });
          }

          if (request.oldSha !== request.newSha) {
            rememberBranchTagChange({
              repoRoot: request.repoRoot,
              branch: request.branch,
              oldSha: request.oldSha,
              newSha: request.newSha,
            });
          }
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to update branch.";
        }

        return null;
      },
    );
  };
  const openRowAfterDoubleClick = async (row: CommitGraphRow) => {
    if (!row.isCommitRow) {
      return;
    }

    const gitCheckoutDescription =
      row.commit.localBranches.length > 0
        ? "Switching branch"
        : "Switching to commit";

    await runUserGitUpdateThenRefreshDashboard(
      gitCheckoutDescription,
      "Switched HEAD.",
      async () => {
        try {
          await window.molttree.checkoutGitCommit({
            repoRoot,
            sha: row.commit.sha,
          });
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to switch HEAD.";
        }

        return null;
      },
    );
  };

  const isBranchPointerMoveDetachingWorktree =
    branchPointerMove !== null &&
    branchPointerMove.sourcePath !== null &&
    branchPointerMove.targetPath === null &&
    branchPointerMove.oldSha === branchPointerMove.newSha;

  return (
    <>
      <Card className="commit-history gap-0 py-0 ring-0" ref={commitHistoryRef}>
        <div
          className="commit-history-header-scroll"
          ref={commitHistoryHeaderScrollRef}
        >
          <div className="commit-history-header">
            <div className="commit-history-header-cell commit-history-graph-title">
              <span>Graph</span>
              <Resizable
                axis="x"
                width={graphWidth}
                height={COMMIT_HISTORY_HEADER_HEIGHT}
                minConstraints={[
                  graphMinimumWidth,
                  COMMIT_HISTORY_HEADER_HEIGHT,
                ]}
                maxConstraints={[graphMaxWidth, COMMIT_HISTORY_HEADER_HEIGHT]}
                resizeHandles={["e"]}
                handle={(resizeHandle, ref) => (
                  <span
                    className={`commit-history-panel-resize react-resizable-handle react-resizable-handle-${resizeHandle}`}
                    ref={ref}
                  />
                )}
                onResize={(_event, data) => resizeGraphColumn(data)}
              >
                <div
                  className="commit-history-graph-resize-surface"
                  aria-hidden="true"
                />
              </Resizable>
            </div>
            <div className="commit-history-header-cell">
              <Button
                className="commit-history-header-toggle"
                variant="ghost"
                size="xs"
                type="button"
                aria-pressed={shouldShowChatOnly}
                onClick={() => {
                  setShouldShowChatOnly(!shouldShowChatOnly);
                }}
              >
                Codex Chats
              </Button>
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
              <span>Code Locations</span>
              <CommitHistoryColumnResizeHandle
                columnKey="codeLocations"
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
        </div>
        <div
          className="commit-history-body-scroll"
          onScroll={(event) => {
            if (commitHistoryHeaderScrollRef.current !== null) {
              commitHistoryHeaderScrollRef.current.scrollLeft =
                event.currentTarget.scrollLeft;
            }
          }}
        >
          <div className="commit-history-body">
            <CommitGraphSvg graph={visibleGraph} graphWidth={graphWidth} />
            {visibleGraph.rows.map((row) => (
              <CommitHistoryRow
                key={row.id}
                row={row}
                repoRoot={repoRoot}
                mainWorktreePath={mainWorktreePath}
                worktrees={worktrees}
                currentBranch={currentBranch}
                defaultBranch={defaultBranch}
                isHeadClean={isHeadClean}
                threadOfId={threadOfId}
                gitChangesOfCwd={gitChangesOfCwd}
                isBranchPointerDropTarget={
                  branchPointerDropTargetRowId === row.id
                }
                shouldOwnMainWorktreeHead={
                  mainWorktreeHeadOwnerRowId === row.id
                }
                isBranchMergeableOfBranch={isBranchMergeableOfBranch}
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
                showErrorMessage={showErrorMessage}
                startBranchPointerDrag={startBranchPointerDrag}
                finishBranchPointerDrag={finishBranchPointerDrag}
              />
            ))}
          </div>
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
                    Create a branch tag for this commit.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  autoFocus
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
                {shouldShowBranchNamePreview ? (
                  <p className="branch-name-preview">
                    Branch name will become: <code>{createdBranchName}</code>
                  </p>
                ) : null}
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
                    disabled={createdBranchName.length === 0}
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
                  <DialogTitle>Commit</DialogTitle>
                  <DialogDescription>Enter a commit message.</DialogDescription>
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
            <DialogContent className="change-summary-modal">
              <DialogHeader>
                <DialogTitle>Change Summary</DialogTitle>
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
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => {
                    void openCodePath(changeSummaryTarget.path);
                  }}
                >
                  Open Repository
                </Button>
              </DialogFooter>
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
        <Dialog
          open={branchMergeConfirmation !== null}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              return;
            }

            closeBranchMergeConfirmationModal();
          }}
        >
          {branchMergeConfirmation === null ? null : (
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Merge Branch</DialogTitle>
                <DialogDescription>
                  Merge {branchMergeConfirmation.branch} into HEAD?
                </DialogDescription>
              </DialogHeader>
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
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeBranchMergeConfirmationModal}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={confirmBranchMerge}>
                  Merge
                </Button>
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>
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
                  {isBranchPointerMoveDetachingWorktree
                    ? `Move the ${branchPointerMove.branch} branch tag back to this commit?`
                    : branchPointerMove.targetPath === null
                      ? `Move the ${branchPointerMove.branch} branch pointer?`
                      : `Switch this worktree to ${branchPointerMove.branch}?`}
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
                {isBranchPointerMoveDetachingWorktree
                  ? "Git will detach that worktree and keep its changes."
                  : branchPointerMove.targetPath !== null
                    ? "Git will keep the existing changes if they can apply on that branch."
                    : branchPointerMove.willMoveCheckedOutWorktree
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
  repoHeaderControls,
  pathLauncher,
  refreshDashboard,
  refreshDashboardAfterUserGitUpdate,
  runUserGitUpdate,
  showSuccessMessage,
  showErrorMessage,
  rememberBranchTagChange,
}: {
  repo: RepoGraph;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  repoHeaderControls: ReactElement;
  pathLauncher: PathLauncher;
  refreshDashboard: () => Promise<void>;
  refreshDashboardAfterUserGitUpdate: (
    finishUserGitUpdate: () => void,
  ) => Promise<boolean>;
  runUserGitUpdate: (
    userGitUpdateDescription: string,
    updateGit: (finishUserGitUpdate: () => void) => Promise<void>,
  ) => Promise<void>;
  showSuccessMessage: (message: string) => void;
  showErrorMessage: (message: string) => void;
  rememberBranchTagChange: (branchTagChange: GitBranchTagChange) => void;
}) => {
  return (
    <section className="repo-section">
      <div className="repo-header">{repoHeaderControls}</div>

      <div className="repo-panel">
        <CommitHistory
          commits={repo.commits}
          worktrees={repo.worktrees}
          threadOfId={threadOfId}
          repoRoot={repo.root}
          mainWorktreePath={repo.mainWorktreePath}
          currentBranch={repo.currentBranch}
          defaultBranch={repo.defaultBranch}
          gitChangesOfCwd={gitChangesOfCwd}
          pathLauncher={pathLauncher}
          refreshDashboard={refreshDashboard}
          refreshDashboardAfterUserGitUpdate={
            refreshDashboardAfterUserGitUpdate
          }
          runUserGitUpdate={runUserGitUpdate}
          showSuccessMessage={showSuccessMessage}
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
  const [pathLauncher, setPathLauncher] = useState<PathLauncher>("vscode");
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<
    string | null
  >(null);
  const [branchTagChanges, setBranchTagChanges] = useState<
    GitBranchTagChange[]
  >([]);
  const [branchTagChangeConfirmation, setBranchTagChangeConfirmation] =
    useState<BranchTagChangeConfirmation | null>(null);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [userGitUpdateCount, setUserGitUpdateCount] = useState(0);
  const [userGitUpdateDescription, setUserGitUpdateDescription] = useState("");
  const userGitUpdateCountRef = useRef(0);
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

  const applyDashboardData = useCallback((nextDashboardData: DashboardData) => {
    setDashboardData(nextDashboardData);
    setBranchTagChanges((currentBranchTagChanges) =>
      syncBranchTagChangesWithDashboardData({
        branchTagChanges: currentBranchTagChanges,
        dashboardData: nextDashboardData,
      }),
    );

    if (nextDashboardData.gitErrors.length > 0) {
      setDashboardErrorMessage(nextDashboardData.gitErrors.join("\n"));
    } else {
      setDashboardErrorMessage(null);
    }
  }, []);
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

            if (userGitUpdateCountRef.current === 0) {
              applyDashboardData(nextDashboardData);
            }
          } catch (error) {
            if (userGitUpdateCountRef.current > 0) {
              continue;
            }

            const message =
              error instanceof Error
                ? error.message
                : "Failed to read dashboard data.";
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
  }, [applyDashboardData]);
  const refreshDashboardAfterUserGitUpdate = useCallback(
    async (finishUserGitUpdate: () => void) => {
      setIsLoading(true);

      try {
        const nextDashboardData = await window.molttree.readDashboard();
        finishUserGitUpdate();
        applyDashboardData(nextDashboardData);
        return true;
      } catch (error) {
        finishUserGitUpdate();
        const message =
          error instanceof Error
            ? error.message
            : "Failed to read dashboard data.";
        setDashboardErrorMessage(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [applyDashboardData],
  );
  useEffect(() => {
    return window.molttree.watchCodexThreadStatus((codexThreadStatusChange) => {
      setDashboardData((currentDashboardData) => {
        if (currentDashboardData === null) {
          return currentDashboardData;
        }

        let didUpdateThread = false;
        const threads = currentDashboardData.threads.map((thread) => {
          if (thread.id !== codexThreadStatusChange.threadId) {
            return thread;
          }

          didUpdateThread = true;

          return {
            ...thread,
            status: codexThreadStatusChange.status,
          };
        });

        if (!didUpdateThread) {
          return currentDashboardData;
        }

        return {
          ...currentDashboardData,
          threads,
        };
      });
    });
  }, []);
  const showSuccessMessage = useCallback((message: string) => {
    toast.success(message, {
      closeButton: false,
      duration: SUCCESS_MESSAGE_TIMEOUT_MS,
      position: TOAST_POSITION,
    });
  }, []);
  const showErrorMessage = useCallback((message: string) => {
    toast.error("Error", {
      description: message,
      duration: Infinity,
      position: TOAST_POSITION,
    });
  }, []);
  // User Git updates use this wrapper so the loading toast is tied to action results, not background polling.
  const runUserGitUpdate = useCallback(
    async (
      userGitUpdateDescription: string,
      updateGit: (finishUserGitUpdate: () => void) => Promise<void>,
    ) => {
      let didFinishUserGitUpdate = false;
      const finishUserGitUpdate = () => {
        if (didFinishUserGitUpdate) {
          return;
        }

        didFinishUserGitUpdate = true;
        const nextUserGitUpdateCount = userGitUpdateCountRef.current - 1;
        userGitUpdateCountRef.current = nextUserGitUpdateCount;
        setUserGitUpdateCount(nextUserGitUpdateCount);

        if (nextUserGitUpdateCount === 0) {
          setUserGitUpdateDescription("");
        }
      };

      setUserGitUpdateDescription(userGitUpdateDescription);
      userGitUpdateCountRef.current += 1;
      setUserGitUpdateCount(userGitUpdateCountRef.current);

      try {
        await updateGit(finishUserGitUpdate);
      } finally {
        finishUserGitUpdate();
      }
    },
    [],
  );
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
      if (userGitUpdateCountRef.current > 0) {
        return;
      }

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
    if (dashboardErrorMessage === null) {
      return;
    }

    toast.error("Dashboard error", {
      description: dashboardErrorMessage,
      duration: Infinity,
      position: TOAST_POSITION,
    });
  }, [dashboardErrorMessage]);

  useEffect(() => {
    if (userGitUpdateCount === 0) {
      toast.dismiss(USER_GIT_UPDATE_TOAST_ID);
      return;
    }

    toast.loading("Updating", {
      className: "git-update-toast-shell",
      closeButton: false,
      description: userGitUpdateDescription,
      dismissible: false,
      duration: Infinity,
      id: USER_GIT_UPDATE_TOAST_ID,
      position: TOAST_POSITION,
    });
  }, [userGitUpdateCount, userGitUpdateDescription]);

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

    await runUserGitUpdate(
      branchTagChangeActionText.loadingDescription,
      async (finishUserGitUpdate) => {
        let gitSuccessMessage: string | null = null;
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
          gitSuccessMessage = branchTagChangeActionText.successMessage;
        } catch (error) {
          gitErrorMessage =
            error instanceof Error
              ? error.message
              : "Failed to apply branch tag changes.";
        }

        const didRefreshDashboard =
          await refreshDashboardAfterUserGitUpdate(finishUserGitUpdate);

        if (gitErrorMessage !== null) {
          showErrorMessage(gitErrorMessage);
          return;
        }

        if (didRefreshDashboard && gitSuccessMessage !== null) {
          showSuccessMessage(gitSuccessMessage);
        }
      },
    );
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

  if (dashboardData === null) {
    return (
      <>
        <main className="initial-loading-screen">
          <div className="initial-loading-content">
            <img
              alt=""
              className="initial-loading-image"
              draggable={false}
              src={initialLoadingImageUrl}
            />
            <div className="initial-loading-status">
              <LoaderCircle
                aria-hidden="true"
                className="initial-loading-spinner"
                size={16}
              />
              <span>Loading repositories...</span>
            </div>
          </div>
        </main>
        <Toaster />
      </>
    );
  }
  const openSelectedRepoPath = async () => {
    if (selectedRepo === null) {
      return;
    }

    try {
      await window.molttree.openPath({
        path: selectedRepo.root,
        launcher: pathLauncher,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open repo.";
      showErrorMessage(message);
    }
  };
  const changeSelectedRepoRoot = (repoRoot: string) => {
    setSelectedRepoRoot(repoRoot);
  };
  const changePathLauncher = (value: string) => {
    const nextPathLauncher = readPathLauncher(value);

    if (nextPathLauncher !== null) {
      setPathLauncher(nextPathLauncher);
    }
  };
  const selectedRepoBranchTagChanges =
    selectedRepo === null
      ? []
      : readVisibleBranchTagChangesForRepo(selectedRepo.root);
  const repoHeaderControls = (
    <>
      {dashboardData.repos.length === 0 ? null : (
        <div className="repo-picker">
          <Select
            value={selectedRepo?.root ?? ""}
            onValueChange={changeSelectedRepoRoot}
          >
            <SelectTrigger
              className="repo-picker-select"
              id="repo-picker-select"
              size="sm"
            >
              <SelectValue placeholder="Select repo" />
            </SelectTrigger>
            <SelectContent align="end" className="repo-picker-select-content">
              {dashboardData.repos.map((repo) => (
                <SelectItem value={repo.root} key={repo.root}>
                  {readRepoFolderName(repo)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="repo-header-controls">
        <div className="path-launcher-control">
          <button
            aria-label="Open selected repo"
            className="path-launcher-open"
            type="button"
            disabled={selectedRepo === null}
            onClick={() => {
              void openSelectedRepoPath();
            }}
          >
            <PathLauncherIcon pathLauncher={pathLauncher} />
          </button>
          <Select value={pathLauncher} onValueChange={changePathLauncher}>
            <SelectTrigger
              aria-label="Choose app for opening paths"
              className="path-launcher-select"
              size="sm"
            />
            <SelectContent align="end" className="path-launcher-select-content">
              <PathLauncherSelectItems />
            </SelectContent>
          </Select>
        </div>
        <div className="repo-actions">
          {selectedRepo === null ? null : (
            <>
              <button
                className="repo-action-control"
                type="button"
                aria-label="Revert branches"
                onClick={() =>
                  openBranchTagChangeModal("reset", selectedRepo.root)
                }
                disabled={selectedRepoBranchTagChanges.length === 0}
              >
                <CircleArrowLeft
                  aria-hidden="true"
                  size={18}
                  strokeWidth={1.75}
                />
                <span>Revert</span>
              </button>
              <button
                className="repo-action-control"
                type="button"
                aria-label="Pull branches"
                onClick={() =>
                  openBranchTagChangeModal("pull", selectedRepo.root)
                }
                disabled={selectedRepoBranchTagChanges.length === 0}
              >
                <CircleArrowDown
                  aria-hidden="true"
                  size={18}
                  strokeWidth={1.75}
                />
                <span>Pull</span>
              </button>
              <button
                className="repo-action-control"
                type="button"
                aria-label="Push branches"
                onClick={() =>
                  openBranchTagChangeModal("push", selectedRepo.root)
                }
                disabled={selectedRepoBranchTagChanges.length === 0}
              >
                <CircleArrowUp
                  aria-hidden="true"
                  size={18}
                  strokeWidth={1.75}
                />
                <span>Push</span>
              </button>
            </>
          )}
          <button
            aria-label="Open About"
            className="repo-action-control"
            type="button"
            onClick={() => setIsAboutModalOpen(true)}
          >
            <Info aria-hidden="true" size={18} strokeWidth={1.75} />
            <span>About</span>
          </button>
        </div>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <main className="app-shell">
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
        <Dialog open={isAboutModalOpen} onOpenChange={setIsAboutModalOpen}>
          <DialogContent aria-describedby={undefined} className="about-modal">
            <DialogHeader>
              <DialogTitle>About MoltTree</DialogTitle>
            </DialogHeader>
            <dl className="about-modal-fields">
              <div className="about-modal-field">
                <dt>Version:</dt>
                <dd>v{packageInfo.version}</dd>
              </div>
            </dl>
          </DialogContent>
        </Dialog>

        {dashboardData.warnings.length > 0 && (
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
                gitChangesOfCwd={dashboardData.gitChangesOfCwd}
                repoHeaderControls={repoHeaderControls}
                pathLauncher={pathLauncher}
                refreshDashboard={refreshDashboard}
                refreshDashboardAfterUserGitUpdate={
                  refreshDashboardAfterUserGitUpdate
                }
                runUserGitUpdate={runUserGitUpdate}
                showSuccessMessage={showSuccessMessage}
                showErrorMessage={showErrorMessage}
                rememberBranchTagChange={rememberBranchTagChange}
              />
            )}
            {dashboardData.repos.length === 0 && !isLoading && (
              <Empty className="empty-state">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LuGitCommitHorizontal size={22} />
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
      <Toaster />
    </TooltipProvider>
  );
};
