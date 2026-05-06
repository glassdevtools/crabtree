import {
  CircleCheck,
  ChevronDown,
  ChevronRight,
  CircleArrowDown,
  CircleArrowUp,
  Copy,
  FileDiff,
  GitCompareArrows,
  LoaderCircle,
  Settings,
  Tag,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { Dialog as RadixDialog } from "radix-ui";
import { FaTerminal } from "react-icons/fa";
import { GoDotFill } from "react-icons/go";
import {
  LuCheck,
  LuCornerRightUp,
  LuGitBranchPlus,
  LuGitCommitHorizontal,
  LuGitPullRequestArrow,
} from "react-icons/lu";
import { VscVscode } from "react-icons/vsc";
import { Resizable } from "react-resizable";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  startTransition,
  useState,
} from "react";
import type {
  DragEvent,
  FormEvent,
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import type { ResizeCallbackData } from "react-resizable";
import type {
  AppUpdateStatus,
  ChatProviderDetection,
  ChatProviderId,
  CodexThread,
  CodexThreadStatusChange,
  DashboardData,
  GitBranchSyncChange,
  GitChangeCounts,
  GitChangeSummary,
  GitCommit,
  GitDiffFile,
  GitDiffRequest,
  GitMergePreview,
  GitWorktree,
  PathLauncher,
  RepoGraph,
  TerminalSessionEvent,
} from "../shared/types";
import type { IDisposable as XtermDisposable } from "@xterm/xterm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
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
import codexChatIconUrl from "./assets/codex-chat-icon.png";
import cursorAppIconUrl from "./assets/cursor-app-icon.png";
import finderAppIconUrl from "./assets/finder-app-icon.png";
import openCodeChatIconUrl from "./assets/opencode-chat-icon.svg";
import {
  readChangedWorkingTreeCwdsOfSha,
  readChangedWorkingTreeShaForCwd,
  readDisplayedThreadGroups,
  readGitChangeCleanState,
  readIsCwdInsidePath,
  readIsGitChangeSummaryEmpty,
  readIsWorktreeCwd,
  readShouldShowChatOnlyCommitGraphRow,
} from "./threadGroups";
import {
  readCommitHistoryCheckoutsForCommit,
  readCommitHistoryRowCheckouts,
  readDirtyCommitHistoryCheckoutBranches,
  readDuplicateCheckedOutBranchOfBranch,
} from "./commitHistoryCheckouts";
import {
  readCommitHistoryRowHeight,
  readCommitHistoryRowLayouts,
} from "./commitHistoryLayout";
import {
  readAutomaticBranchName,
  readAutomaticCommitMessage,
  readCreatedGitRefName,
} from "./gitRefs";
import {
  readGitDiffLineCounts,
  readGitDiffLineDisplay,
  readGitDiffMarkerColumnCount,
} from "./gitDiffLines";
import { readBranchSyncPushWarningMessages } from "./branchSyncWarnings";
import type { ThreadGroup } from "./threadGroups";
import {
  readIsAnalyticsPrivateMode,
  setAnalyticsPrivateMode,
  trackDesktopAppOpened,
  trackDesktopAction,
} from "./analytics";
import packageInfo from "../../package.json";
import "@xterm/xterm/css/xterm.css";

// The history view is a SourceTree-style row table. Git owns the commits; the renderer only assigns lanes.
// TODO: AI-PICKED-VALUE: These graph sizes and colors are initial SourceTree-like choices for dense commit rows.
const COMMIT_GRAPH_ROW_HEIGHT = 20;
const COMMIT_GRAPH_LANE_WIDTH = 14;
const COMMIT_GRAPH_PADDING_LEFT = 16;
const COMMIT_GRAPH_MIN_WIDTH = 96;
const COMMIT_GRAPH_INITIAL_EXTRA_WIDTH = 60;
const COMMIT_GRAPH_MAX_INITIAL_WIDTH = 600;
const COMMIT_GRAPH_DOT_RADIUS = 4;
// TODO: AI-PICKED-VALUE: This slightly larger outer dot makes the HEAD commit distinct without adding another icon.
const COMMIT_GRAPH_HEAD_DOT_RADIUS = 4.75;
// TODO: AI-PICKED-VALUE: This center dot makes the HEAD commit distinct without hiding the commit color.
const COMMIT_GRAPH_HEAD_CENTER_DOT_RADIUS = 2.25;
// TODO: AI-PICKED-VALUE: This keeps right-click menus from touching the window edge.
const CONTEXT_MENU_WINDOW_MARGIN = 8;
// TODO: AI-PICKED-VALUE: This keeps graph lines readable in compact rows while making them less heavy.
const COMMIT_GRAPH_SEGMENT_STROKE_WIDTH = 2.25;
// TODO: AI-PICKED-VALUE: This neutral gray makes changed cwd rows read as working-tree state instead of Git history.
const COMMIT_GRAPH_CWD_CHANGE_COLOR = "#8b929c";
const COMMIT_GRAPH_ROW_CONNECTION_INSET_RATIO = 0;
const COMMIT_HISTORY_HEADER_HEIGHT = 22;
// Dashboard reads touch Codex and Git, so automatic refreshes run only when the previous read has finished.
// TODO: AI-PICKED-VALUE: Refreshing one second after each automatic read keeps branch/worktree state current without queuing Git reads.
const DASHBOARD_REFRESH_INTERVAL_MS = 1000;
const TOAST_POSITION = "bottom-center";
const UNFOCUSED_ERROR_TOAST_DURATION_MS = Infinity;
const USER_GIT_UPDATE_TOAST_ID_PREFIX = "user-git-update";
const DASHBOARD_WARNING_TOAST_ID_PREFIX = "dashboard-warning";
const GITHUB_REPOSITORY_URL = packageInfo.repository.url.replace(/\.git$/, "");
console.log("[Crabtree renderer]", { version: packageInfo.version });
const CHECKED_OUT_BY_WORKTREE_MESSAGE =
  "This branch is checked out in a worktree. Delete the worktree or switch its branch first.";
const DUPLICATE_CHECKOUT_BRANCH_WARNING =
  "This is checked out in multiple places, which often leads to confusion. We recommend adding a new branch here instead.";
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
    changedFileCount: 0,
  },
  unstaged: {
    added: 0,
    removed: 0,
    changedFileCount: 0,
  },
};

const readTotalGitChangeSummary = (changeSummary: GitChangeSummary) => {
  return {
    added: changeSummary.staged.added + changeSummary.unstaged.added,
    removed: changeSummary.staged.removed + changeSummary.unstaged.removed,
    changedFileCount:
      changeSummary.staged.changedFileCount +
      changeSummary.unstaged.changedFileCount,
  };
};

const readChangedFileCountText = (changedFileCount: number) => {
  return changedFileCount === 1
    ? `${changedFileCount} file`
    : `${changedFileCount} files`;
};

// Binary changes can have file changes without line counts, so the graph uses this shared display for both cases.
const GitChangeCountText = ({
  changeCounts,
}: {
  changeCounts: GitChangeCounts;
}) => {
  if (
    changeCounts.added === 0 &&
    changeCounts.removed === 0 &&
    changeCounts.changedFileCount > 0
  ) {
    return (
      <span className="commit-thread-change-file-count">
        {readChangedFileCountText(changeCounts.changedFileCount)}
      </span>
    );
  }

  return (
    <>
      <span className="commit-thread-change-added">+{changeCounts.added}</span>
      <span className="commit-thread-change-removed">
        -{changeCounts.removed}
      </span>
    </>
  );
};

const GitDiffLine = ({
  line,
  markerColumnCount,
}: {
  line: string;
  markerColumnCount: number;
}) => {
  const lineDisplay = readGitDiffLineDisplay({ line, markerColumnCount });
  let className = "row-diff-line";

  if (lineDisplay === null) {
    return null;
  }

  switch (lineDisplay.changeType) {
    case "added":
      className = `${className} row-diff-line-added`;
      break;
    case "removed":
      className = `${className} row-diff-line-removed`;
      break;
    case "context":
      break;
  }

  return <span className={className}>{lineDisplay.text}</span>;
};

const readUserFacingErrorMessage = (message: string) => {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "");
};

const readCaughtUserFacingErrorMessage = ({
  error,
  fallbackMessage,
}: {
  error: unknown;
  fallbackMessage: string;
}) => {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const userFacingMessage = readUserFacingErrorMessage(message);

  if (userFacingMessage !== message) {
    console.error(message);
  }

  return userFacingMessage;
};

const showErrorToast = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => {
  const isWindowFocused = document.hasFocus();

  if (isWindowFocused) {
    toast.error(title, {
      closeButton: false,
      description,
      position: TOAST_POSITION,
    });
    return;
  }

  toast.error(title, {
    closeButton: true,
    description,
    duration: UNFOCUSED_ERROR_TOAST_DURATION_MS,
    position: TOAST_POSITION,
  });
};

const readGitRefCreateText = (gitRefType: "branch" | "tag") => {
  switch (gitRefType) {
    case "branch":
      return {
        title: "Create Branch",
        description: "Enter a new branch name.",
        nameLabel: "Branch name",
        previewLabel: "Branch name will become",
        loadingDescription: "Creating branch",
        successMessage: "Created branch.",
        errorMessage: "Failed to create branch.",
      };
    case "tag":
      return {
        title: "Create Tag",
        description: "Enter a new tag name.",
        nameLabel: "Tag name",
        previewLabel: "Tag name will become",
        loadingDescription: "Creating tag",
        successMessage: "Created tag.",
        errorMessage: "Failed to create tag.",
      };
  }
};

const readBranchSyncActionText = (
  action: BranchSyncAction,
): BranchSyncActionText => {
  switch (action) {
    case "push":
      return {
        title: "Push",
        message: "Push local tag changes to origin?",
        buttonText: "Push",
        loadingDescription: "Pushing",
        successMessage: "Successfully pushed to origin.",
      };
    case "revert":
      return {
        title: "Sync",
        message:
          "Revert local tag changes so they match origin? This will revert these tag changes:",
        buttonText: "Sync",
        loadingDescription: "Syncing",
        successMessage: "Successfully synced with origin.",
      };
  }
};

const readBranchSyncChangeTypeText = (
  branchSyncChanges: GitBranchSyncChange[],
) => {
  let hasBranchChange = false;
  let hasTagChange = false;

  for (const branchSyncChange of branchSyncChanges) {
    switch (branchSyncChange.gitRefType) {
      case "branch":
        hasBranchChange = true;
        break;
      case "tag":
        hasTagChange = true;
        break;
    }
  }

  if (hasBranchChange && hasTagChange) {
    return "branch and tag";
  }

  if (hasTagChange) {
    return "tag";
  }

  return "branch";
};

const readBranchSyncChangeSummary = ({
  branchSyncChange,
  summaryMode,
}: {
  branchSyncChange: GitBranchSyncChange;
  summaryMode: BranchSyncChangeSummaryMode;
}) => {
  const oldSha = branchSyncChange.originSha;
  const newSha = branchSyncChange.localSha;

  if (oldSha === null && newSha !== null) {
    if (summaryMode === "default") {
      return (
        <>
          <strong className="branch-tag-change-action-create">create</strong> on{" "}
          {newSha.slice(0, 7)}
        </>
      );
    }

    return (
      <>
        <strong className="branch-tag-change-action-create">create</strong>
      </>
    );
  }

  if (oldSha !== null && newSha === null) {
    if (summaryMode === "default") {
      return (
        <>
          <strong className="branch-tag-change-action-delete">delete</strong>{" "}
          from {oldSha.slice(0, 7)}
        </>
      );
    }

    return (
      <>
        <strong className="branch-tag-change-action-delete">delete</strong>
      </>
    );
  }

  if (oldSha !== null && newSha !== null) {
    if (summaryMode === "rowPush") {
      return null;
    }

    return `move ${oldSha.slice(0, 7)} to ${newSha.slice(0, 7)}`;
  }

  return null;
};

const readAppUpdateButtonText = (appUpdateStatus: AppUpdateStatus) => {
  switch (appUpdateStatus.type) {
    case "ready":
      return "Update";
    case "checking":
      return "Checking...";
    case "downloading":
      return "Downloading...";
    case "unavailable":
      return "Updates disabled";
    case "idle":
    case "error":
      return "Check for updates";
  }
};

const readChatProviderLabel = (providerId: ChatProviderId) => {
  switch (providerId) {
    case "openCode":
      return "OpenCode";
  }
};

const DEFAULT_CHAT_PROVIDER_DETECTIONS: ChatProviderDetection[] = [
  { providerId: "openCode", isDetected: false },
];

const ChatProviderDetectionStatus = ({
  isDetected,
}: {
  isDetected: boolean;
}) => {
  return (
    <span
      className={cn(
        "chat-provider-detection-status",
        isDetected
          ? "chat-provider-detection-status-detected"
          : "chat-provider-detection-status-missing",
      )}
    >
      {isDetected ? (
        <CircleCheck aria-hidden="true" size={15} strokeWidth={2.25} />
      ) : (
        <X aria-hidden="true" size={15} strokeWidth={2.25} />
      )}
      <span>{isDetected ? "auto detected" : "not detected"}</span>
    </span>
  );
};

const readGitWarningReasonText = (reasons: string[]) => {
  if (reasons.length === 1) {
    return reasons[0] ?? "";
  }

  if (reasons.length === 2) {
    return `${reasons[0]}, and ${reasons[1]}`;
  }

  const lastReason = reasons[reasons.length - 1] ?? "";

  return `${reasons.slice(0, -1).join(", ")}, and ${lastReason}`;
};
const TAG_STABILITY_WARNING_REASON =
  "people and build pipelines often expect tags not to move";

const GitRefModalBadge = ({
  gitRefType,
  name,
}: {
  gitRefType: "branch" | "tag";
  name: string;
}) => {
  return (
    <Badge
      className={cn(
        "commit-ref",
        gitRefType === "branch" ? "commit-ref-local" : "commit-ref-tag",
        "branch-tag-change-ref",
      )}
      variant="secondary"
    >
      {name}
    </Badge>
  );
};

const readBranchPointerOperationText = ({
  gitRefType,
  refName,
}: {
  gitRefType: "branch" | "tag";
  refName: string;
}) => {
  if (gitRefType === "tag") {
    return {
      title: "Move Tag",
      message: (
        <span className="dialog-description-inline">
          Move <GitRefModalBadge gitRefType="tag" name={refName} />?
        </span>
      ),
      description: null,
      loadingDescription: "Moving tag",
      successMessage: "Moved tag.",
      buttonText: "Move",
      shouldBlock: false,
    };
  }

  return {
    title: "Move Branch Pointer",
    message: (
      <span className="dialog-description-inline">
        Move <GitRefModalBadge gitRefType="branch" name={refName} /> branch
        pointer?
      </span>
    ),
    description: null,
    loadingDescription: "Moving branch",
    successMessage: "Moved branch.",
    buttonText: "Move",
    shouldBlock: false,
  };
};

const readActionableBranchSyncChanges = ({
  action,
  branchSyncChanges,
}: {
  action: BranchSyncAction;
  branchSyncChanges: GitBranchSyncChange[];
}) => {
  switch (action) {
    case "push":
      return branchSyncChanges;
    case "revert":
      return branchSyncChanges;
  }
};

const TitleTooltip = ({
  title,
  children,
}: {
  title: ReactNode;
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

const BottomTitleTooltip = ({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactElement;
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
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

const readPathLauncherLabel = (pathLauncher: PathLauncher) => {
  switch (pathLauncher) {
    case "vscode":
      return "VS Code";
    case "cursor":
      return "Cursor";
    case "finder":
      return "Finder";
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

const copyText = async ({
  text,
  errorMessage,
}: {
  text: string;
  errorMessage: string;
}) => {
  try {
    await window.crabtree.copyText(text);
    toast.success("Copied!", {
      closeButton: false,
      description: <div className="copy-toast-value">{text}</div>,
      position: TOAST_POSITION,
    });
  } catch (error) {
    const message = readCaughtUserFacingErrorMessage({
      error,
      fallbackMessage: errorMessage,
    });
    showErrorToast({ title: "Error", description: message });
  }
};

const readRepoFolderName = (repo: RepoGraph) => {
  return repo.root.split("/").pop() ?? repo.root;
};

// TODO: AI-PICKED-VALUE: These column widths match the current table layout closely enough while making drag resizing concrete.
const COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS = {
  graph: COMMIT_GRAPH_MIN_WIDTH,
  actors: 128,
  branchTags: 240,
  description: 294,
  commit: 84,
  author: 150,
  date: 170,
};
// TODO: AI-PICKED-VALUE: These smaller resize limits keep columns usable while allowing the page to compress much further.
const COMMIT_HISTORY_MIN_COLUMN_WIDTHS = {
  actors: 44,
  branchTags: 72,
  description: 120,
  commit: 52,
  author: 64,
  date: 82,
};
const COMMIT_HISTORY_MIN_DETAILS_WIDTH =
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.actors +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.branchTags +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.description +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.commit +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.author +
  COMMIT_HISTORY_MIN_COLUMN_WIDTHS.date;

type CommitHistoryColumnKey =
  | "actors"
  | "branchTags"
  | "description"
  | "commit"
  | "author"
  | "date";

type CommitHistoryColumnWidths = {
  graph: number;
  actors: number;
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

type BranchPointerDrag = {
  repoRoot: string;
  gitRefType: "branch" | "tag" | "head";
  refName: string;
  sourcePath: string | null;
  oldSha: string;
  oldShortSha: string;
  oldSubject: string;
};

type BranchPointerMove = {
  repoRoot: string;
  gitRefType: "branch" | "tag";
  refName: string;
  oldSha: string;
  oldShortSha: string;
  oldSubject: string;
  newSha: string;
  newShortSha: string;
  newSubject: string;
  sourcePath: string | null;
  targetPath: string | null;
  warningMessage: string | null;
};

type GitRefDeleteTarget = {
  gitRefType: "branch" | "tag";
  name: string;
  oldSha: string;
  warningMessage: string | null;
  shouldBlockDelete: boolean;
};

type BranchCreateTarget = {
  type: "commit";
  repoRoot: string;
  sha: string;
  title: string;
};

type RowDiffTarget = {
  title: string;
  description: string;
  repositoryPath: string | null;
  request: GitDiffRequest;
};

type RowDiffLoadState =
  | { type: "loading" }
  | { type: "loaded"; files: GitDiffFile[] }
  | { type: "error"; message: string };

type RowContextMenuTarget = {
  x: number;
  y: number;
  sha: string | null;
  isEnabled: boolean;
  pullRequestTarget: GitPullRequestCreateTarget | null;
  changesMadeHereTarget: RowDiffTarget;
  diffAgainstHeadTarget: RowDiffTarget;
};

type CopyContextMenuTarget = {
  text: string;
  errorMessage: string;
  x: number;
  y: number;
};

type GitRefContextMenuTarget = {
  gitRefType: "branch" | "tag";
  name: string;
  oldSha: string;
  warningMessage: string | null;
  shouldBlockDelete: boolean;
  x: number;
  y: number;
};

type GitRefCreateTarget = {
  gitRefType: "branch" | "tag";
  sha: string;
};

type GitPullRequestCreateTarget = {
  sha: string;
  subject: string;
  baseBranches: string[];
  headBranches: string[];
  defaultBaseBranch: string | null;
};

type CommitBranchTarget = {
  branch: string;
  oldSha: string;
};

type CommitChangesTarget =
  | {
      type: "commit";
      path: string;
      fallbackMessage: string;
      branchTarget: CommitBranchTarget;
    }
  | {
      type: "createBranchAndCommit";
      path: string;
      branch: string;
      expectedHeadSha: string;
      fallbackMessage: string;
    };

type TerminalTarget = {
  cwd: string;
};
type BranchMergeConfirmation = {
  branch: string;
  targetBranch: string;
  preview: GitMergePreview;
};

type HeadMoveConfirmation = {
  row: CommitGraphRow;
  targetText: string;
};

type BranchSyncAction = "push" | "revert";

type BranchSyncChangeSummaryMode = "default" | "rowPush";

type BranchSyncActionText = {
  title: string;
  message: string;
  buttonText: string;
  loadingDescription: string;
  successMessage: string;
};

type BranchSyncConfirmation = {
  action: BranchSyncAction;
  repoRoot: string;
};

type BranchPushConfirmation = {
  branchSyncChanges: GitBranchSyncChange[];
};

type CommitGraphRow = {
  id: string;
  commit: GitCommit;
  threadIds: string[];
  threadGroup: ThreadGroup | null;
  isCommitRow: boolean;
  shouldShowHeadDot: boolean;
  lane: number;
  color: string;
  rowIndex: number;
  lineCount: number;
  childCount: number;
};

type CommitGraphItem = {
  id: string;
  commit: GitCommit;
  sha: string;
  parents: string[];
  threadIds: string[];
  unchangedThreadGroupCount: number;
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

const readIsOpenCodeThread = (thread: CodexThread) => {
  return thread.source === "openCode";
};

const ChatProviderIcon = ({
  isOpenCodeThread,
}: {
  isOpenCodeThread: boolean;
}) => {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn(
        "commit-thread-provider-icon",
        isOpenCodeThread
          ? "commit-thread-provider-icon-opencode"
          : "commit-thread-provider-icon-codex",
      )}
      src={isOpenCodeThread ? openCodeChatIconUrl : codexChatIconUrl}
    />
  );
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
    columnWidths.actors +
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

// Pull requests use pushed origin branches so the app never has to push from the create-PR flow.
const readOriginBranchName = (ref: string) => {
  const originPrefix = "origin/";
  const refName = cleanRefName(ref);

  if (refName === "origin/HEAD" || !refName.startsWith(originPrefix)) {
    return null;
  }

  return refName.slice(originPrefix.length);
};

const readPushedBranchNamesForCommit = (commit: GitCommit) => {
  const isPushedBranchOfBranch: { [branch: string]: boolean } = {};
  const isBranchAddedOfBranch: { [branch: string]: boolean } = {};
  const branches: string[] = [];

  for (const ref of commit.refs) {
    const branch = readOriginBranchName(ref);

    if (branch !== null) {
      isPushedBranchOfBranch[branch] = true;
    }
  }

  for (const branch of commit.localBranches) {
    if (
      isPushedBranchOfBranch[branch] !== true ||
      isBranchAddedOfBranch[branch] === true
    ) {
      continue;
    }

    isBranchAddedOfBranch[branch] = true;
    branches.push(branch);
  }

  return branches;
};

const readPushedBranchNames = ({
  commits,
  defaultBranch,
}: {
  commits: GitCommit[];
  defaultBranch: string | null;
}) => {
  const isBranchAddedOfBranch: { [branch: string]: boolean } = {};
  const branches: string[] = [];
  const pushBranch = (branch: string) => {
    if (isBranchAddedOfBranch[branch] === true) {
      return;
    }

    isBranchAddedOfBranch[branch] = true;
    branches.push(branch);
  };

  if (defaultBranch !== null) {
    for (const commit of commits) {
      for (const ref of commit.refs) {
        if (readOriginBranchName(ref) === defaultBranch) {
          pushBranch(defaultBranch);
        }
      }
    }
  }

  for (const commit of commits) {
    for (const ref of commit.refs) {
      const branch = readOriginBranchName(ref);

      if (branch !== null) {
        pushBranch(branch);
      }
    }
  }

  return branches;
};

const createCommitGraph = ({
  commits,
  threadOfId,
  mainWorktreePath,
  worktrees,
  gitChangesOfCwd,
}: {
  commits: GitCommit[];
  threadOfId: { [id: string]: CodexThread };
  mainWorktreePath: string;
  worktrees: GitWorktree[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
}) => {
  const graphItems: CommitGraphItem[] = [];
  const commitOfSha: { [sha: string]: GitCommit } = {};
  const firstParentChildCountOfSha: { [sha: string]: number } = {};
  const childCountOfSha: { [sha: string]: number } = {};
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

    for (const parent of commit.parents) {
      childCountOfSha[parent] = (childCountOfSha[parent] ?? 0) + 1;
    }
  }

  let headSha: string | null = null;

  for (const commit of commits) {
    if (commit.refs.some((ref) => readIsHeadRef(ref))) {
      headSha = commit.sha;
      break;
    }
  }

  const changedWorkingTreeCwdsOfSha = readChangedWorkingTreeCwdsOfSha({
    headSha,
    mainWorktreePath,
    worktrees,
    gitChangesOfCwd,
  });

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

      const changedWorkingTreeSha = readChangedWorkingTreeShaForCwd({
        cwd: thread.cwd,
        changedWorkingTreeCwdsOfSha,
      });
      let displaySha = commit.sha;

      if (changedWorkingTreeSha !== null) {
        displaySha = changedWorkingTreeSha;
      } else if (
        headSha !== null &&
        !readIsWorktreeCwd({ cwd: thread.cwd, worktrees })
      ) {
        displaySha = headSha;
      }

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

  const readNewLaneColorIndex = ({ sha }: { sha: string }) => {
    const colorSeedSha = readEarliestLaneColorSeedSha({ sha });

    // Colors stay tied to the earliest visible line seed, so new commits do not repaint older graph lines.
    return readCommitGraphColorIndex(colorSeedSha);
  };

  for (const commit of commits) {
    const commitThreadIds = displayedThreadIdsOfSha[commit.sha] ?? [];
    const threads = commitThreadIds
      .map((threadId) => threadOfId[threadId])
      .filter((thread): thread is CodexThread => thread !== undefined);
    const threadGroups = readDisplayedThreadGroups({
      threads,
      changedWorkingTreeCwds: changedWorkingTreeCwdsOfSha[commit.sha] ?? [],
      worktrees,
      gitChangesOfCwd,
    });
    const changedThreadGroups: ThreadGroup[] = [];
    const unchangedThreadIds: string[] = [];
    let unchangedThreadGroupCount = 0;

    for (const threadGroup of threadGroups) {
      if (readIsThreadGroupChanged(threadGroup)) {
        changedThreadGroups.push(threadGroup);
        continue;
      }

      unchangedThreadGroupCount += 1;

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
      unchangedThreadGroupCount,
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
        colorIndex = readNewLaneColorIndex({ sha: graphItem.sha });
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
        shouldShowHeadDot: false,
        lane: threadGroupLane,
        color: COMMIT_GRAPH_CWD_CHANGE_COLOR,
        rowIndex,
        lineCount: 1,
        childCount: childCountOfSha[graphItem.sha] ?? 0,
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
      shouldShowHeadDot: graphItem.commit.refs.some((ref) =>
        readIsHeadRef(ref),
      ),
      lane,
      color: readCommitGraphColor(commitLane.colorIndex),
      rowIndex,
      lineCount: Math.max(1, graphItem.unchangedThreadGroupCount),
      childCount: childCountOfSha[graphItem.sha] ?? 0,
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
          parentColorIndex = readNewLaneColorIndex({ sha: parent });
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
  commitSha,
  commitShortSha,
  commitSubject,
  branchPointerSourcePath,
  duplicateCheckedOutBranchOfBranch,
  deleteWarningMessageOfBranch,
  deleteWarningMessageOfTag,
  shouldBlockDeleteOfBranch,
  openCopyContextMenu,
  openGitRefContextMenu,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  refs: string[];
  localBranches: string[];
  commitSha: string;
  commitShortSha: string;
  commitSubject: string;
  branchPointerSourcePath: string | null;
  duplicateCheckedOutBranchOfBranch: { [branch: string]: boolean };
  deleteWarningMessageOfBranch: { [branch: string]: string };
  deleteWarningMessageOfTag: { [tag: string]: string };
  shouldBlockDeleteOfBranch: { [branch: string]: boolean };
  openCopyContextMenu: (
    event: MouseEvent<Element>,
    text: string,
    errorMessage: string,
  ) => void;
  openGitRefContextMenu: (
    event: MouseEvent<Element>,
    gitRefContextMenuTarget: Omit<GitRefContextMenuTarget, "x" | "y">,
  ) => void;
  startBranchPointerDrag: ({
    event,
    gitRefType,
    refName,
    sourcePath,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    gitRefType: "branch" | "tag" | "head";
    refName: string;
    sourcePath: string | null;
    oldSha: string;
    oldShortSha: string;
    oldSubject: string;
  }) => void;
  finishBranchPointerDrag: () => void;
}) => {
  const refsWithLocalBranches = [...refs];
  const isRefOfName: { [name: string]: boolean } = {};

  for (const ref of refs) {
    isRefOfName[readIsHeadRef(ref) ? "HEAD" : cleanRefName(ref)] = true;
  }

  for (const localBranch of localBranches) {
    if (isRefOfName[localBranch] === true) {
      continue;
    }

    refsWithLocalBranches.push(localBranch);
  }

  const isLocalBranchOfName: { [name: string]: boolean } = {};
  const isRowLocalBranchOfName: { [name: string]: boolean } = {};

  for (const localBranch of localBranches) {
    isLocalBranchOfName[localBranch] = true;
    isRowLocalBranchOfName[localBranch] = true;
  }

  for (const ref of refsWithLocalBranches) {
    const refName = cleanRefName(ref);

    if (ref.startsWith("tag: ")) {
      isRefOfName[refName] = true;
    }
  }

  const normalRefs = refsWithLocalBranches.filter((ref) => !readIsHeadRef(ref));
  const headRefs = refsWithLocalBranches.filter((ref) => readIsHeadRef(ref));
  const orderedRefs = [
    ...headRefs,
    ...normalRefs.filter(
      (ref) =>
        !ref.startsWith("tag: ") && !cleanRefName(ref).startsWith("origin/"),
    ),
    ...normalRefs.filter((ref) => ref.startsWith("tag: ")),
    ...normalRefs.filter((ref) => {
      const refName = cleanRefName(ref);
      const originPrefix = "origin/";

      if (ref.startsWith("tag: ") || !refName.startsWith(originPrefix)) {
        return false;
      }

      return (
        isRowLocalBranchOfName[refName.slice(originPrefix.length)] !== true &&
        isRefOfName[refName.slice(originPrefix.length)] !== true
      );
    }),
  ];

  if (orderedRefs.length === 0) {
    return null;
  }

  return (
    <div className="commit-label-list">
      {orderedRefs.map((ref) => {
        const isHead = readIsHeadRef(ref);
        const refName = isHead ? "HEAD" : cleanRefName(ref);
        const cleanName = cleanRefName(ref);
        const isLocalBranch = isLocalBranchOfName[refName] === true;
        const isTag = ref.startsWith("tag: ");
        const isOriginBranch = refName.startsWith("origin/");
        const shouldDragRef = isHead || isLocalBranch || isTag;
        let refClassName = "commit-ref commit-ref-local";
        const originBranchName =
          isOriginBranch && refName !== "origin/HEAD"
            ? refName.slice("origin/".length)
            : null;
        const originBranchTooltip =
          originBranchName === null
            ? null
            : `${originBranchName} is here on origin, but not here locally. Push or Sync to update origin.`;
        const deleteWarningMessage = isTag
          ? (deleteWarningMessageOfTag[cleanName] ?? null)
          : (deleteWarningMessageOfBranch[refName] ?? null);
        const shouldBlockDelete =
          !isTag && shouldBlockDeleteOfBranch[refName] === true;
        const shouldShowDuplicateCheckoutWarning =
          isLocalBranch && duplicateCheckedOutBranchOfBranch[refName] === true;

        if (isOriginBranch) {
          refClassName = "commit-ref commit-ref-origin";
        }

        if (isTag) {
          refClassName = "commit-ref commit-ref-tag";
        }

        if (isHead) {
          refClassName = "commit-ref commit-ref-head";
        }

        const refBadge = (
          <Badge
            className={cn(
              refClassName,
              shouldDragRef && "commit-ref-draggable",
            )}
            variant="secondary"
            draggable={shouldDragRef}
            key={ref}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              if (isTag || isLocalBranch) {
                openGitRefContextMenu(event, {
                  gitRefType: isTag ? "tag" : "branch",
                  name: isTag ? cleanName : refName,
                  oldSha: commitSha,
                  warningMessage: deleteWarningMessage,
                  shouldBlockDelete,
                });
                return;
              }

              openCopyContextMenu(
                event,
                refName,
                isTag
                  ? "Failed to copy tag name."
                  : "Failed to copy branch name.",
              );
            }}
            onDragStart={(event) => {
              if (!shouldDragRef) {
                return;
              }

              startBranchPointerDrag({
                event,
                gitRefType: isHead ? "head" : isTag ? "tag" : "branch",
                refName,
                sourcePath: isTag ? null : branchPointerSourcePath,
                oldSha: commitSha,
                oldShortSha: commitShortSha,
                oldSubject: commitSubject,
              });
            }}
            onDragEnd={finishBranchPointerDrag}
          >
            {shouldShowDuplicateCheckoutWarning ? (
              <TitleTooltip title={DUPLICATE_CHECKOUT_BRANCH_WARNING}>
                <span
                  className="commit-ref-duplicate-checkout-warning"
                  role="img"
                  aria-label={DUPLICATE_CHECKOUT_BRANCH_WARNING}
                >
                  <TriangleAlert
                    aria-hidden="true"
                    size={9}
                    strokeWidth={2.25}
                  />
                </span>
              </TitleTooltip>
            ) : null}
            <span>{refName}</span>
          </Badge>
        );

        if (originBranchTooltip !== null) {
          return (
            <TitleTooltip title={originBranchTooltip} key={ref}>
              <span className="title-tooltip-trigger">{refBadge}</span>
            </TitleTooltip>
          );
        }

        return refBadge;
      })}
    </div>
  );
};

const ChatRobotTags = ({
  threadGroups,
  pathLauncher,
  isTerminalBusyOfCwd,
  openCopyContextMenu,
  openCodePath,
  openTerminalModal,
  showErrorMessage,
}: {
  threadGroups: ThreadGroup[];
  pathLauncher: PathLauncher;
  isTerminalBusyOfCwd: { [cwd: string]: boolean };
  openCopyContextMenu: (
    event: MouseEvent<Element>,
    text: string,
    errorMessage: string,
  ) => void;
  openCodePath: (path: string) => Promise<void>;
  openTerminalModal: (
    event: MouseEvent<HTMLButtonElement>,
    cwd: string,
  ) => void;
  showErrorMessage: (message: string) => void;
}) => {
  if (threadGroups.length === 0) {
    return null;
  }

  const openThread = async (thread: CodexThread) => {
    try {
      if (readIsOpenCodeThread(thread)) {
        if (thread.cwd.length === 0) {
          showErrorMessage("OpenCode chat does not have a folder.");
          return;
        }

        const openCodeUrl = new URL("opencode://open-project");

        openCodeUrl.searchParams.set("directory", thread.cwd);
        await window.crabtree.openExternalUrl(openCodeUrl.toString());
        trackDesktopAction({
          eventName: "chat_opened",
          properties: { provider: "openCode" },
        });
        return;
      }

      await window.crabtree.openCodexThread(thread.id);
      trackDesktopAction({
        eventName: "chat_opened",
        properties: { provider: "codex" },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open chat.";
      showErrorMessage(message);
    }
  };

  const pathLauncherLabel = readPathLauncherLabel(pathLauncher);
  const shouldStackThreadGroups = threadGroups.length > 1;

  return (
    <div
      className={cn(
        "commit-label-list commit-thread-group-list",
        shouldStackThreadGroups && "commit-thread-group-list-multiline",
      )}
    >
      {threadGroups.map((threadGroup) => {
        return (
          <span className="commit-thread-group" key={threadGroup.key}>
            {threadGroup.threads.map((thread) => {
              const title = threadTitle(thread);
              const isThreadActive = readIsThreadActive(thread);
              const isOpenCodeThread = readIsOpenCodeThread(thread);
              const chatProviderLabel = isOpenCodeThread ? "OpenCode" : "Codex";
              const tooltipLabel = `Open in ${chatProviderLabel}: ${title}`;
              const tooltipTitle = (
                <>
                  {`"`}
                  {title}
                  {`"`}
                  <br />
                  Open in {chatProviderLabel}
                </>
              );

              return (
                <TitleTooltip title={tooltipTitle} key={thread.id}>
                  <Button
                    aria-label={
                      isThreadActive
                        ? `${tooltipLabel} is loading`
                        : tooltipLabel
                    }
                    className="commit-thread-chat"
                    variant="ghost"
                    size="xs"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void openThread(thread);
                    }}
                  >
                    <ChatProviderIcon isOpenCodeThread={isOpenCodeThread} />
                  </Button>
                </TitleTooltip>
              );
            })}
            {threadGroup.cwd.length === 0 ? null : (
              <span className="commit-thread-location-actions">
                <TitleTooltip title={`Open in ${pathLauncherLabel}`}>
                  <Button
                    aria-label={`Open ${threadGroup.cwd}`}
                    className="commit-thread-code-location"
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => {
                      openCopyContextMenu(
                        event,
                        threadGroup.cwd,
                        "Failed to copy path.",
                      );
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void openCodePath(threadGroup.cwd);
                    }}
                  >
                    <PathLauncherIcon pathLauncher={pathLauncher} />
                  </Button>
                </TitleTooltip>
                <TitleTooltip title="Open in Terminal">
                  <Button
                    aria-label={`Open terminal in ${threadGroup.cwd}`}
                    className={
                      isTerminalBusyOfCwd[threadGroup.cwd] === true
                        ? "commit-thread-terminal commit-thread-terminal-busy"
                        : "commit-thread-terminal"
                    }
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) =>
                      openTerminalModal(event, threadGroup.cwd)
                    }
                  >
                    <FaTerminal
                      aria-hidden="true"
                      className="commit-thread-terminal-icon"
                      size={8}
                    />
                    {isTerminalBusyOfCwd[threadGroup.cwd] === true ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="commit-thread-terminal-loading-icon"
                        size={9}
                      />
                    ) : null}
                  </Button>
                </TitleTooltip>
              </span>
            )}
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
  const graphRowLayout = readCommitHistoryRowLayouts({
    rows: graph.rows,
    rowHeight: COMMIT_GRAPH_ROW_HEIGHT,
  });
  const graphHeight = graphRowLayout.totalHeight;
  const readSegmentY = (rowIndex: number) => {
    const rowLayout = graphRowLayout.rowLayouts[rowIndex];

    if (rowLayout === undefined) {
      return graphHeight;
    }

    return rowLayout.center;
  };
  const readSegmentConnectionY = (rowIndex: number) => {
    const rowLayout = graphRowLayout.rowLayouts[rowIndex];

    if (rowLayout === undefined) {
      return graphHeight;
    }

    return (
      rowLayout.top + rowLayout.height * COMMIT_GRAPH_ROW_CONNECTION_INSET_RATIO
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
          readSegmentConnectionY(segment.toRowIndex),
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

      {graph.rows.map((row, rowIndex) => {
        const rowLayout = graphRowLayout.rowLayouts[rowIndex];

        if (rowLayout === undefined) {
          return null;
        }

        const centerX = readCommitGraphX(row.lane);
        const centerY = rowLayout.center;

        return (
          <g key={row.id}>
            <circle
              cx={centerX}
              cy={centerY}
              r={
                row.shouldShowHeadDot
                  ? COMMIT_GRAPH_HEAD_DOT_RADIUS
                  : COMMIT_GRAPH_DOT_RADIUS
              }
              fill={row.color}
            />
            {row.shouldShowHeadDot ? (
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
  branchSyncChanges,
  repoRoot,
  mainWorktreePath,
  worktrees,
  currentBranch,
  isHeadClean,
  threadOfId,
  gitChangesOfCwd,
  isBranchNameUsedOfBranch,
  isCommitMessageUsedOfMessage,
  pathLauncher,
  isTerminalBusyOfCwd,
  isBranchPointerDropTarget,
  duplicateCheckedOutBranchOfBranch,
  isBranchMergeableOfBranch,
  isCommitMergeableOfSha,
  deleteWarningMessageOfBranch,
  deleteWarningMessageOfTag,
  shouldBlockDeleteOfBranch,
  updateBranchPointerDropTarget,
  clearBranchPointerDropTarget,
  finishBranchPointerDrop,
  openRowContextMenu,
  openRowAfterDoubleClick,
  openBranchCreateModal,
  openCommitChangesModal,
  openChangesDiffModal,
  openBranchMergeModal,
  openBranchPushModal,
  openCopyContextMenu,
  openGitRefContextMenu,
  openCodePath,
  openTerminalModal,
  showErrorMessage,
  startBranchPointerDrag,
  finishBranchPointerDrag,
}: {
  row: CommitGraphRow;
  branchSyncChanges: GitBranchSyncChange[];
  repoRoot: string;
  mainWorktreePath: string;
  worktrees: GitWorktree[];
  currentBranch: string | null;
  isHeadClean: boolean;
  threadOfId: { [id: string]: CodexThread };
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  isBranchNameUsedOfBranch: { [branch: string]: boolean };
  isCommitMessageUsedOfMessage: { [message: string]: boolean };
  pathLauncher: PathLauncher;
  isTerminalBusyOfCwd: { [cwd: string]: boolean };
  isBranchPointerDropTarget: boolean;
  duplicateCheckedOutBranchOfBranch: { [branch: string]: boolean };
  isBranchMergeableOfBranch: { [branch: string]: boolean };
  isCommitMergeableOfSha: { [sha: string]: boolean };
  deleteWarningMessageOfBranch: { [branch: string]: string };
  deleteWarningMessageOfTag: { [tag: string]: string };
  shouldBlockDeleteOfBranch: { [branch: string]: boolean };
  updateBranchPointerDropTarget: (event: DragEvent<HTMLDivElement>) => void;
  clearBranchPointerDropTarget: (event: DragEvent<HTMLDivElement>) => void;
  finishBranchPointerDrop: (event: DragEvent<HTMLDivElement>) => void;
  openRowContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    row: CommitGraphRow,
  ) => void;
  openRowAfterDoubleClick: () => void;
  openBranchCreateModal: (
    event: MouseEvent<HTMLButtonElement>,
    branchCreateTarget: BranchCreateTarget,
  ) => void;
  openCommitChangesModal: (
    event: MouseEvent<HTMLButtonElement>,
    commitChangesTarget: CommitChangesTarget,
  ) => void;
  openChangesDiffModal: (
    event: MouseEvent<HTMLButtonElement>,
    rowDiffTarget: RowDiffTarget,
  ) => void;
  openBranchMergeModal: (
    event: MouseEvent<HTMLButtonElement>,
    branch: string,
  ) => void;
  openBranchPushModal: (
    event: MouseEvent<HTMLButtonElement>,
    branchSyncChanges: GitBranchSyncChange[],
  ) => void;
  openCopyContextMenu: (
    event: MouseEvent<Element>,
    text: string,
    errorMessage: string,
  ) => void;
  openGitRefContextMenu: (
    event: MouseEvent<Element>,
    gitRefContextMenuTarget: Omit<GitRefContextMenuTarget, "x" | "y">,
  ) => void;
  openCodePath: (path: string) => Promise<void>;
  openTerminalModal: (
    event: MouseEvent<HTMLButtonElement>,
    cwd: string,
  ) => void;
  showErrorMessage: (message: string) => void;
  startBranchPointerDrag: ({
    event,
    gitRefType,
    refName,
    sourcePath,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    gitRefType: "branch" | "tag" | "head";
    refName: string;
    sourcePath: string | null;
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
          changedWorkingTreeCwds: [],
          worktrees,
          gitChangesOfCwd,
        })
      : [row.threadGroup];
  const rowThreadIdOfId: { [threadId: string]: boolean } = {};

  for (const rowThreadId of row.threadIds) {
    rowThreadIdOfId[rowThreadId] = true;
  }

  const checkoutsForCommit = readCommitHistoryCheckoutsForCommit({
    commitSha: commit.sha,
    isMainHeadCommit: commit.refs.some((ref) => readIsHeadRef(ref)),
    mainWorktreePath,
    currentBranch,
    worktrees,
    gitChangesOfCwd,
  });
  const rowCheckouts = readCommitHistoryRowCheckouts({
    checkouts: checkoutsForCommit,
    changedWorkingTreeCwd:
      row.threadGroup === null ? null : row.threadGroup.cwd,
  });
  const dirtyCheckoutBranchOfBranch =
    readDirtyCommitHistoryCheckoutBranches(checkoutsForCommit);
  const movedThreadBranchOfBranch: { [branch: string]: boolean } = {};
  const rowCheckoutBranchOfBranch: { [branch: string]: boolean } = {};
  const rowCheckoutRefs: string[] = [];
  const worktreesForRow: GitWorktree[] = [];
  const rowLocalBranches: string[] = [];
  const isRowLocalBranchAddedOfBranch: { [branch: string]: boolean } = {};

  const pushRowLocalBranch = (branch: string) => {
    if (isRowLocalBranchAddedOfBranch[branch] === true) {
      return;
    }

    isRowLocalBranchAddedOfBranch[branch] = true;
    rowLocalBranches.push(branch);
  };

  for (const rowCheckout of rowCheckouts) {
    if (rowCheckout.isMainWorktree) {
      rowCheckoutRefs.push(
        rowCheckout.branch === null ? "HEAD" : `HEAD -> ${rowCheckout.branch}`,
      );
    } else if (rowCheckout.worktree !== null) {
      worktreesForRow.push(rowCheckout.worktree);
    }

    if (rowCheckout.branch !== null) {
      rowCheckoutBranchOfBranch[rowCheckout.branch] = true;
      pushRowLocalBranch(rowCheckout.branch);
    }
  }

  if (row.threadGroup === null) {
    for (const commitThreadId of commit.threadIds) {
      const thread = threadOfId[commitThreadId];

      if (thread === undefined) {
        continue;
      }

      const threadBranch = thread.gitInfo?.branch ?? null;

      if (
        threadBranch === null ||
        !readIsLocalBranch({
          branch: threadBranch,
          localBranches: commit.localBranches,
        })
      ) {
        continue;
      }

      if (rowThreadIdOfId[commitThreadId] === true) {
        pushRowLocalBranch(threadBranch);
        continue;
      }

      const isMainWorktreeThread =
        thread.cwd.length > 0 &&
        readIsCwdInsidePath({ cwd: thread.cwd, path: mainWorktreePath }) &&
        !readIsWorktreeCwd({ cwd: thread.cwd, worktrees });

      if (!isMainWorktreeThread) {
        movedThreadBranchOfBranch[threadBranch] = true;
      }
    }
  }

  if (row.threadGroup === null) {
    for (const localBranch of commit.localBranches) {
      const isBranchMovedToAnotherRow =
        (dirtyCheckoutBranchOfBranch[localBranch] === true ||
          movedThreadBranchOfBranch[localBranch] === true) &&
        rowCheckoutBranchOfBranch[localBranch] !== true;

      if (isBranchMovedToAnotherRow) {
        continue;
      }

      pushRowLocalBranch(localBranch);
    }
  }

  const rowCommitRefs =
    row.threadGroup === null
      ? commit.refs.filter((ref) => {
          const refName = cleanRefName(ref);

          if (
            readIsHeadRef(ref) &&
            rowCheckoutRefs.some((rowCheckoutRef) =>
              readIsHeadRef(rowCheckoutRef),
            ) === false &&
            checkoutsForCommit.some(
              (checkout) => checkout.isMainWorktree && checkout.isDirty,
            )
          ) {
            return false;
          }

          if (
            !readIsLocalBranch({
              branch: refName,
              localBranches: commit.localBranches,
            })
          ) {
            return true;
          }

          return (
            (dirtyCheckoutBranchOfBranch[refName] !== true &&
              movedThreadBranchOfBranch[refName] !== true) ||
            rowCheckoutBranchOfBranch[refName] === true
          );
        })
      : [];

  const rowRefs = row.threadGroup === null ? rowCommitRefs : rowCheckoutRefs;
  const rowCurrentBranch =
    row.threadGroup === null ? currentBranch : (rowLocalBranches[0] ?? null);
  const isHeadRow = row.shouldShowHeadDot;
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
  const actionBranchThread =
    actionThreadGroup === null ? undefined : actionThreadGroup.threads[0];
  const actionBranchTitle =
    actionThreadGroup === null
      ? ""
      : actionBranchThread === undefined
        ? actionThreadGroup.cwd
        : threadTitle(actionBranchThread);
  const actionBranchFallbackTitle =
    actionThreadGroup === null
      ? ""
      : actionBranchThread === undefined
        ? actionThreadGroup.cwd
        : actionBranchThread.id;
  const actionBranchToCreate =
    actionThreadGroup !== null &&
    rowLocalBranches.length === 0 &&
    actionThreadGroup.cwd.length > 0 &&
    shouldShowActionChangeCount
      ? readAutomaticBranchName({
          title: actionBranchTitle,
          fallbackTitle: actionBranchFallbackTitle,
          isBranchNameUsedOfBranch,
        })
      : null;
  const actionCommitChangesTarget: CommitChangesTarget | null =
    actionThreadGroup === null ||
    actionThreadGroup.cwd.length === 0 ||
    !shouldShowActionChangeCount
      ? null
      : actionCommitBranchTarget !== null
        ? {
            type: "commit",
            path: actionThreadGroup.cwd,
            branchTarget: actionCommitBranchTarget,
            fallbackMessage: readAutomaticCommitMessage({
              branch: actionCommitBranchTarget.branch,
              isCommitMessageUsedOfMessage,
            }),
          }
        : actionBranchToCreate === null
          ? null
          : {
              type: "createBranchAndCommit",
              path: actionThreadGroup.cwd,
              branch: actionBranchToCreate,
              expectedHeadSha: commit.sha,
              fallbackMessage: readAutomaticCommitMessage({
                branch: actionBranchToCreate,
                isCommitMessageUsedOfMessage,
              }),
            };
  const shouldShowActionCommit = actionCommitChangesTarget !== null;
  const pushableGitRefSyncChanges = branchSyncChanges.filter(
    (branchSyncChange) =>
      branchSyncChange.localSha !== branchSyncChange.originSha,
  );
  const rowPushableGitRefSyncChanges = pushableGitRefSyncChanges.filter(
    (branchSyncChange) => {
      if (branchSyncChange.localSha !== null) {
        if (branchSyncChange.localSha !== commit.sha) {
          return false;
        }

        switch (branchSyncChange.gitRefType) {
          case "branch":
            return rowLocalBranches.includes(branchSyncChange.name);
          case "tag":
            return rowRefs.some(
              (ref) =>
                ref.startsWith("tag: ") &&
                cleanRefName(ref) === branchSyncChange.name,
            );
        }
      }

      if (branchSyncChange.originSha !== commit.sha) {
        return false;
      }

      switch (branchSyncChange.gitRefType) {
        case "branch":
          return rowRefs.some(
            (ref) => cleanRefName(ref) === `origin/${branchSyncChange.name}`,
          );
        case "tag":
          return false;
      }
    },
  );
  const hasPushableGitRefSyncChangeOnRow =
    rowPushableGitRefSyncChanges.length > 0;
  const mergeBranch =
    currentBranch === null || !row.isCommitRow || isHeadRow
      ? null
      : (rowLocalBranches.find(
          (localBranch) =>
            localBranch !== currentBranch &&
            isBranchMergeableOfBranch[localBranch] === true,
        ) ?? null);
  const shouldShowCreateBranchToMerge =
    currentBranch !== null &&
    row.isCommitRow &&
    !isHeadRow &&
    row.childCount === 0 &&
    rowLocalBranches.length === 0 &&
    isCommitMergeableOfSha[commit.sha] === true;
  const createBranchToMergeTarget: BranchCreateTarget | null =
    shouldShowCreateBranchToMerge
      ? {
          type: "commit",
          repoRoot,
          sha: commit.sha,
          title: commit.subject,
        }
      : null;
  let mergeDisabledReason: string | null = null;
  let rowClassName = "commit-history-row";

  if (mergeBranch !== null && isHeadClean === false) {
    mergeDisabledReason = "Before merging, resolve your changes";
  }

  const mergeBranchButtonTitle =
    mergeBranch === null || currentBranch === null
      ? ""
      : `Merge this into ${currentBranch}`;
  const shouldShowGraphThreadActions =
    actionThreadGroup !== null && shouldShowActionChangeCount;
  const shouldShowBranchPushAction =
    hasPushableGitRefSyncChangeOnRow &&
    !shouldShowActionCommit &&
    mergeBranch === null;
  const shouldShowGraphActions =
    shouldShowGraphThreadActions ||
    (row.isCommitRow &&
      (mergeBranch !== null ||
        shouldShowBranchPushAction ||
        createBranchToMergeTarget !== null ||
        isHeadRow));
  const commitDateText = formatCommitDate(commit.date);
  let branchTagsCellClassName = "commit-branch-tags-cell";

  if (isBranchPointerDropTarget) {
    rowClassName = `${rowClassName} commit-history-row-branch-drop-target`;
    branchTagsCellClassName = `${branchTagsCellClassName} commit-branch-tags-cell-branch-drop-target`;
  }

  const branchPointerSourcePath = rowRefs.some((ref) => readIsHeadRef(ref))
    ? mainWorktreePath
    : readBranchPointerRowPath({
        row,
        repoRoot,
        worktrees,
      });

  return (
    <div
      className={rowClassName}
      style={{
        height: readCommitHistoryRowHeight({
          lineCount: row.lineCount,
          rowHeight: COMMIT_GRAPH_ROW_HEIGHT,
        }),
      }}
      onDoubleClick={row.isCommitRow ? openRowAfterDoubleClick : undefined}
      onContextMenu={(event) => openRowContextMenu(event, row)}
      onDragOver={updateBranchPointerDropTarget}
      onDragLeave={clearBranchPointerDropTarget}
      onDrop={finishBranchPointerDrop}
    >
      <div className="commit-graph-cell">
        {shouldShowGraphActions ? (
          <div className="commit-graph-actions">
            {shouldShowGraphThreadActions ? (
              <div className="commit-graph-thread-actions">
                <TitleTooltip title="Changes">
                  <Button
                    className="commit-thread-change-count"
                    variant="ghost"
                    size="xs"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) =>
                      openChangesDiffModal(event, {
                        title: "Changes",
                        description: actionThreadGroup.cwd,
                        repositoryPath: actionThreadGroup.cwd,
                        request: {
                          mode: "changesMadeHere",
                          target: {
                            type: "path",
                            path: actionThreadGroup.cwd,
                          },
                        },
                      })
                    }
                  >
                    <GitChangeCountText
                      changeCounts={actionTotalChangeSummary}
                    />
                  </Button>
                </TitleTooltip>
                {actionCommitChangesTarget === null ? null : (
                  <TitleTooltip title="Commit">
                    <Button
                      className="commit-thread-commit-action"
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={(event) =>
                        openCommitChangesModal(event, actionCommitChangesTarget)
                      }
                    >
                      <LuCheck
                        size={COMMIT_GRAPH_ACTION_ICON_SIZE}
                        strokeWidth={COMMIT_GRAPH_ACTION_ICON_STROKE_WIDTH}
                      />
                    </Button>
                  </TitleTooltip>
                )}
              </div>
            ) : null}
            {shouldShowBranchPushAction ? (
              <TitleTooltip title="Push">
                <Button
                  className="commit-branch-push-action"
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    openBranchPushModal(event, rowPushableGitRefSyncChanges)
                  }
                >
                  <CircleArrowUp
                    size={COMMIT_GRAPH_ACTION_ICON_SIZE}
                    strokeWidth={COMMIT_GRAPH_ACTION_ICON_STROKE_WIDTH}
                  />
                </Button>
              </TitleTooltip>
            ) : mergeBranch === null && createBranchToMergeTarget !== null ? (
              <TitleTooltip title="Add branch here">
                <Button
                  className="commit-branch-create-action"
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) =>
                    openBranchCreateModal(event, createBranchToMergeTarget)
                  }
                >
                  <LuGitBranchPlus
                    size={COMMIT_GRAPH_ACTION_ICON_SIZE}
                    strokeWidth={COMMIT_GRAPH_ACTION_ICON_STROKE_WIDTH}
                  />
                </Button>
              </TitleTooltip>
            ) : mergeBranch === null ? null : (
              <TitleTooltip
                title={
                  mergeDisabledReason === null
                    ? mergeBranchButtonTitle
                    : mergeDisabledReason
                }
              >
                <span className="title-tooltip-trigger">
                  <Button
                    className="commit-graph-merge-action"
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={mergeBranchButtonTitle}
                    disabled={mergeDisabledReason !== null}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) =>
                      openBranchMergeModal(event, mergeBranch)
                    }
                  >
                    <LuCornerRightUp
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
          pathLauncher={pathLauncher}
          isTerminalBusyOfCwd={isTerminalBusyOfCwd}
          openCopyContextMenu={openCopyContextMenu}
          openCodePath={openCodePath}
          openTerminalModal={openTerminalModal}
          showErrorMessage={showErrorMessage}
        />
      </div>
      <div className={branchTagsCellClassName}>
        {row.isCommitRow || rowRefs.length > 0 || worktreesForRow.length > 0 ? (
          <BranchTags
            refs={rowRefs}
            localBranches={rowLocalBranches}
            commitSha={commit.sha}
            commitShortSha={commit.shortSha}
            commitSubject={commit.subject}
            branchPointerSourcePath={branchPointerSourcePath}
            duplicateCheckedOutBranchOfBranch={
              duplicateCheckedOutBranchOfBranch
            }
            deleteWarningMessageOfBranch={deleteWarningMessageOfBranch}
            deleteWarningMessageOfTag={deleteWarningMessageOfTag}
            shouldBlockDeleteOfBranch={shouldBlockDeleteOfBranch}
            openCopyContextMenu={openCopyContextMenu}
            openGitRefContextMenu={openGitRefContextMenu}
            startBranchPointerDrag={startBranchPointerDrag}
            finishBranchPointerDrag={finishBranchPointerDrag}
          />
        ) : null}
      </div>
      <div
        className="commit-description-cell"
        onContextMenu={
          row.isCommitRow
            ? (event) => {
                openCopyContextMenu(
                  event,
                  commit.subject,
                  "Failed to copy description.",
                );
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
                openCopyContextMenu(
                  event,
                  commit.sha,
                  "Failed to copy commit.",
                );
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
                openCopyContextMenu(
                  event,
                  commit.author,
                  "Failed to copy author.",
                );
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
                openCopyContextMenu(
                  event,
                  commitDateText,
                  "Failed to copy date.",
                );
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

const RowDiffDialog = ({
  rowDiffTarget,
  rowDiffLoadState,
  pathLauncher,
  openCodePath,
  closeRowDiffModal,
}: {
  rowDiffTarget: RowDiffTarget | null;
  rowDiffLoadState: RowDiffLoadState;
  pathLauncher: PathLauncher;
  openCodePath: (path: string) => Promise<void>;
  closeRowDiffModal: () => void;
}) => {
  const [
    isRowDiffFileExpandedOfFileIndex,
    setIsRowDiffFileExpandedOfFileIndex,
  ] = useState<{ [fileIndex: number]: boolean }>({});

  useEffect(() => {
    if (rowDiffLoadState.type !== "loaded") {
      setIsRowDiffFileExpandedOfFileIndex({});
      return;
    }

    const nextIsRowDiffFileExpandedOfFileIndex: {
      [fileIndex: number]: boolean;
    } = {};

    for (
      let fileIndex = 0;
      fileIndex < rowDiffLoadState.files.length;
      fileIndex += 1
    ) {
      nextIsRowDiffFileExpandedOfFileIndex[fileIndex] = true;
    }

    setIsRowDiffFileExpandedOfFileIndex(nextIsRowDiffFileExpandedOfFileIndex);
  }, [rowDiffLoadState]);

  const setAllRowDiffFilesExpanded = (shouldExpand: boolean) => {
    if (rowDiffLoadState.type !== "loaded") {
      return;
    }

    const nextIsRowDiffFileExpandedOfFileIndex: {
      [fileIndex: number]: boolean;
    } = {};

    for (
      let fileIndex = 0;
      fileIndex < rowDiffLoadState.files.length;
      fileIndex += 1
    ) {
      nextIsRowDiffFileExpandedOfFileIndex[fileIndex] = shouldExpand;
    }

    setIsRowDiffFileExpandedOfFileIndex(nextIsRowDiffFileExpandedOfFileIndex);
  };

  const toggleRowDiffFile = (fileIndex: number) => {
    setIsRowDiffFileExpandedOfFileIndex(
      (currentIsRowDiffFileExpandedOfFileIndex) => ({
        ...currentIsRowDiffFileExpandedOfFileIndex,
        [fileIndex]:
          currentIsRowDiffFileExpandedOfFileIndex[fileIndex] === false,
      }),
    );
  };

  const shouldShowRowDiffFileActions =
    rowDiffLoadState.type === "loaded" && rowDiffLoadState.files.length > 0;
  const rowDiffRepositoryPath = rowDiffTarget?.repositoryPath ?? null;
  const pathLauncherLabel = readPathLauncherLabel(pathLauncher);
  const shouldShowSectionOfFileIndex = useMemo(() => {
    const shouldShowSectionOfFileIndex: { [fileIndex: number]: boolean } = {};

    if (rowDiffLoadState.type !== "loaded") {
      return shouldShowSectionOfFileIndex;
    }

    const sectionOfFilePath: {
      [path: string]: { [section: string]: boolean };
    } = {};

    for (const file of rowDiffLoadState.files) {
      if (file.section === null) {
        continue;
      }

      sectionOfFilePath[file.path] = {
        ...(sectionOfFilePath[file.path] ?? {}),
        [file.section]: true,
      };
    }

    for (
      let fileIndex = 0;
      fileIndex < rowDiffLoadState.files.length;
      fileIndex += 1
    ) {
      const file = rowDiffLoadState.files[fileIndex];

      if (file.section === null) {
        continue;
      }

      const sectionOfSection = sectionOfFilePath[file.path];

      if (sectionOfSection === undefined) {
        continue;
      }

      shouldShowSectionOfFileIndex[fileIndex] =
        Object.keys(sectionOfSection).length > 1;
    }

    return shouldShowSectionOfFileIndex;
  }, [rowDiffLoadState]);

  return (
    <Dialog
      open={rowDiffTarget !== null}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          return;
        }

        closeRowDiffModal();
      }}
    >
      {rowDiffTarget === null ? null : (
        <DialogContent className="row-diff-modal">
          <DialogHeader>
            <DialogTitle>{rowDiffTarget.title}</DialogTitle>
            <DialogDescription>{rowDiffTarget.description}</DialogDescription>
          </DialogHeader>
          <div className="row-diff-actions">
            {rowDiffRepositoryPath === null ? null : (
              <Button
                className="row-diff-action-button row-diff-open-action-button"
                variant="outline"
                size="xs"
                type="button"
                onClick={() => {
                  void openCodePath(rowDiffRepositoryPath);
                }}
              >
                <PathLauncherIcon pathLauncher={pathLauncher} />
                <span>Open in {pathLauncherLabel}</span>
              </Button>
            )}
            {shouldShowRowDiffFileActions ? (
              <>
                <Button
                  className="row-diff-action-button"
                  variant="outline"
                  size="xs"
                  type="button"
                  onClick={() => setAllRowDiffFilesExpanded(false)}
                >
                  <span>Collapse all</span>
                </Button>
                <Button
                  className="row-diff-action-button"
                  variant="outline"
                  size="xs"
                  type="button"
                  onClick={() => setAllRowDiffFilesExpanded(true)}
                >
                  <span>Expand all</span>
                </Button>
              </>
            ) : null}
          </div>
          <div className="row-diff-body">
            {rowDiffLoadState.type === "loading" ? (
              <div className="row-diff-message">
                <LoaderCircle
                  aria-hidden="true"
                  className="row-diff-loading-icon"
                  size={14}
                />
                <span>Loading diff...</span>
              </div>
            ) : rowDiffLoadState.type === "error" ? (
              <div className="row-diff-message row-diff-error-message">
                {rowDiffLoadState.message}
              </div>
            ) : rowDiffLoadState.files.length === 0 ? (
              <div className="row-diff-message">No changes found.</div>
            ) : (
              <div className="row-diff-scroll">
                {rowDiffLoadState.files.map((file, fileIndex) => {
                  const markerColumnCount = readGitDiffMarkerColumnCount(
                    file.diff,
                  );
                  const lineCounts = readGitDiffLineCounts({
                    diff: file.diff,
                    markerColumnCount,
                  });

                  return (
                    <section
                      className="row-diff-file"
                      key={`${file.section ?? "diff"}:${file.path}:${fileIndex}`}
                    >
                      <button
                        className="row-diff-file-header"
                        type="button"
                        aria-expanded={
                          isRowDiffFileExpandedOfFileIndex[fileIndex] !== false
                        }
                        onClick={() => toggleRowDiffFile(fileIndex)}
                      >
                        <span
                          className="row-diff-file-toggle"
                          aria-hidden="true"
                        >
                          {isRowDiffFileExpandedOfFileIndex[fileIndex] ===
                          false ? (
                            <ChevronRight size={12} strokeWidth={1.8} />
                          ) : (
                            <ChevronDown size={12} strokeWidth={1.8} />
                          )}
                        </span>
                        {shouldShowSectionOfFileIndex[fileIndex] === true ? (
                          <span className="row-diff-file-section">
                            {file.section}
                          </span>
                        ) : null}
                        <code>{file.path}</code>
                        <span className="row-diff-file-line-counts">
                          <span className="row-diff-file-line-count-added">
                            +{lineCounts.added}
                          </span>
                          <span className="row-diff-file-line-count-removed">
                            -{lineCounts.removed}
                          </span>
                        </span>
                      </button>
                      {isRowDiffFileExpandedOfFileIndex[fileIndex] ===
                      false ? null : (
                        <pre className="row-diff-pre">
                          <code>
                            {file.diff.split("\n").map((line, lineIndex) => (
                              <GitDiffLine
                                line={line}
                                markerColumnCount={markerColumnCount}
                                key={lineIndex}
                              />
                            ))}
                          </code>
                        </pre>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeRowDiffModal}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
};

const ConfirmationDialog = ({
  isOpen,
  closeConfirmationDialog,
  title,
  description,
  children,
  confirmButtonText,
  confirmButtonVariant,
  isConfirmDisabled,
  confirmButtonAction,
}: {
  isOpen: boolean;
  closeConfirmationDialog: () => void;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode | undefined;
  confirmButtonText: ReactNode;
  confirmButtonVariant: "default" | "destructive";
  isConfirmDisabled: boolean;
  confirmButtonAction: () => void;
}) => {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          return;
        }

        closeConfirmationDialog();
      }}
    >
      {isOpen ? (
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeConfirmationDialog}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirmButtonVariant}
              disabled={isConfirmDisabled}
              onClick={confirmButtonAction}
            >
              {confirmButtonText}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
};

// The terminal has its own modal surface because the shared dialog is sized for small forms.
const TerminalModalContent = ({ children }: { children: ReactNode }) => {
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        className="terminal-modal-content"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
};

// The terminal modal renders the browser terminal while the main process owns the shell and cwd.
const TerminalDialog = ({
  terminalTarget,
  closeTerminalModal,
  updateTerminalStatusState,
  showErrorMessage,
}: {
  terminalTarget: TerminalTarget | null;
  closeTerminalModal: () => void;
  updateTerminalStatusState: ({
    cwd,
    isBusy,
  }: {
    cwd: string;
    isBusy: boolean;
  }) => void;
  showErrorMessage: (message: string) => void;
}) => {
  const [terminalElement, setTerminalElement] = useState<HTMLDivElement | null>(
    null,
  );
  const terminalRef = useRef<XtermTerminal | null>(null);
  const setTerminalElementRef = useCallback(
    (nextTerminalElement: HTMLDivElement | null) => {
      setTerminalElement(nextTerminalElement);
    },
    [],
  );

  useLayoutEffect(() => {
    if (terminalTarget === null || terminalElement === null) {
      return;
    }

    const cwd = terminalTarget.cwd;
    const terminal = new XtermTerminal();
    const fitAddon = new FitAddon();
    const queuedTerminalEvents: TerminalSessionEvent[] = [];
    let didWriteSnapshot = false;
    let isDisposed = false;
    let dataDisposable: XtermDisposable | null = null;
    let resizeDisposable: XtermDisposable | null = null;
    let animationFrameId: number | null = null;

    // The writer batches PTY chunks so xterm receives output in order without a render for every process event.
    const createTerminalWriter = ({
      write,
      schedule,
    }: {
      write: (data: string, done: VoidFunction | undefined) => void;
      schedule: (flush: VoidFunction) => void;
    }) => {
      let chunks: string[] | undefined;
      let waits: VoidFunction[] | undefined;
      let isScheduled = false;
      let isWriting = false;

      const settle = () => {
        const hasQueuedChunks = chunks !== undefined && chunks.length > 0;

        if (isScheduled || isWriting || hasQueuedChunks) {
          return;
        }

        const callbacks = waits;

        if (callbacks === undefined || callbacks.length === 0) {
          return;
        }

        waits = undefined;

        for (const callback of callbacks) {
          callback();
        }
      };
      const run = () => {
        if (isWriting) {
          return;
        }

        isScheduled = false;

        const nextChunks = chunks;

        if (nextChunks === undefined || nextChunks.length === 0) {
          settle();
          return;
        }

        chunks = undefined;
        isWriting = true;
        write(nextChunks.join(""), () => {
          isWriting = false;

          if (chunks !== undefined && chunks.length > 0) {
            if (isScheduled) {
              return;
            }

            isScheduled = true;
            schedule(run);
            return;
          }

          settle();
        });
      };
      const push = (data: string) => {
        if (data.length === 0) {
          return;
        }

        if (chunks === undefined) {
          chunks = [data];
        } else {
          chunks.push(data);
        }

        if (isScheduled || isWriting) {
          return;
        }

        isScheduled = true;
        schedule(run);
      };
      const flush = (done: VoidFunction | undefined) => {
        const hasQueuedChunks = chunks !== undefined && chunks.length > 0;

        if (!isScheduled && !isWriting && !hasQueuedChunks) {
          if (done !== undefined) {
            done();
          }

          return;
        }

        if (done !== undefined) {
          if (waits === undefined) {
            waits = [done];
          } else {
            waits.push(done);
          }
        }

        run();
      };

      return { push, flush };
    };
    const terminalWriter = createTerminalWriter({
      write: (data, done) => {
        terminal.write(data, done);
      },
      schedule: queueMicrotask,
    });
    const fitTerminal = () => {
      try {
        fitAddon.fit();
      } catch (error) {
        console.error("Failed to fit terminal.", error);
      }
    };
    const readTerminalDimensions = () => {
      return {
        cols: Math.max(1, terminal.cols),
        rows: Math.max(1, terminal.rows),
      };
    };
    const resizeTerminal = () => {
      fitTerminal();
      const { cols, rows } = readTerminalDimensions();

      void window.crabtree.resizeTerminalSession({
        cwd,
        cols,
        rows,
      });
    };
    const resizeObserver = new ResizeObserver(resizeTerminal);
    const removeTerminalSessionWatch = window.crabtree.watchTerminalSession(
      (terminalSessionEvent) => {
        if (terminalSessionEvent.cwd !== cwd) {
          return;
        }

        switch (terminalSessionEvent.type) {
          case "data":
            if (didWriteSnapshot) {
              terminalWriter.push(terminalSessionEvent.data);
              return;
            }

            queuedTerminalEvents.push(terminalSessionEvent);
            return;
          case "status":
            updateTerminalStatusState({
              cwd,
              isBusy: terminalSessionEvent.isBusy,
            });
            return;
        }
      },
    );

    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);
    terminalRef.current = terminal;
    resizeObserver.observe(terminalElement);
    terminal.focus();
    dataDisposable = terminal.onData((data) => {
      void window.crabtree
        .writeTerminalSession({ cwd, data })
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to write to terminal.";
          showErrorMessage(message);
        });
    });
    resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void window.crabtree.resizeTerminalSession({ cwd, cols, rows });
    });

    animationFrameId = window.requestAnimationFrame(() => {
      fitTerminal();
      terminal.focus();

      const { cols, rows } = readTerminalDimensions();

      void window.crabtree
        .startTerminalSession({
          cwd,
          cols,
          rows,
        })
        .then((terminalSessionSnapshot) => {
          if (isDisposed) {
            return;
          }

          terminalWriter.push(terminalSessionSnapshot.output);
          didWriteSnapshot = true;
          updateTerminalStatusState({
            cwd,
            isBusy: terminalSessionSnapshot.isBusy,
          });

          for (const terminalSessionEvent of queuedTerminalEvents) {
            if (
              terminalSessionEvent.type === "data" &&
              terminalSessionEvent.cursor > terminalSessionSnapshot.cursor
            ) {
              const terminalSessionEventStartCursor =
                terminalSessionEvent.cursor - terminalSessionEvent.data.length;

              if (
                terminalSessionEventStartCursor < terminalSessionSnapshot.cursor
              ) {
                terminalWriter.push(
                  terminalSessionEvent.data.slice(
                    terminalSessionSnapshot.cursor -
                      terminalSessionEventStartCursor,
                  ),
                );
              } else {
                terminalWriter.push(terminalSessionEvent.data);
              }
            }
          }

          terminalWriter.flush(undefined);
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Failed to open terminal.";
          terminalWriter.push(`\r\n${message}\r\n`);
          terminalWriter.flush(undefined);
          updateTerminalStatusState({ cwd, isBusy: false });
          showErrorMessage(message);
        });
    });

    return () => {
      isDisposed = true;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }

      removeTerminalSessionWatch();
      resizeObserver.disconnect();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      terminal.dispose();
    };
  }, [
    showErrorMessage,
    terminalElement,
    terminalTarget,
    updateTerminalStatusState,
  ]);

  return (
    <Dialog
      open={terminalTarget !== null}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          return;
        }

        closeTerminalModal();
      }}
    >
      {terminalTarget === null ? null : (
        <TerminalModalContent>
          <div className="terminal-modal-header">
            <DialogTitle className="terminal-modal-title">Terminal</DialogTitle>
            <DialogDescription>
              <code className="terminal-modal-path">{terminalTarget.cwd}</code>
            </DialogDescription>
          </div>
          <div
            className="terminal-surface"
            ref={setTerminalElementRef}
            aria-label={`Terminal in ${terminalTarget.cwd}`}
            onMouseDown={() => {
              terminalRef.current?.focus();
            }}
          />
          <div className="terminal-modal-footer">
            <Button type="button" onClick={closeTerminalModal}>
              Close
            </Button>
          </div>
          <DialogClose asChild>
            <Button
              aria-label="Close terminal"
              className="terminal-modal-close"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
              <span className="sr-only">Close terminal</span>
            </Button>
          </DialogClose>
        </TerminalModalContent>
      )}
    </Dialog>
  );
};

const BranchCreateDialog = ({
  branchCreateTarget,
  createBranch,
  closeBranchCreateModal,
}: {
  branchCreateTarget: BranchCreateTarget | null;
  createBranch: ({
    branchCreateTarget,
    branch,
  }: {
    branchCreateTarget: BranchCreateTarget;
    branch: string;
  }) => Promise<void>;
  closeBranchCreateModal: () => void;
}) => {
  const [branchName, setBranchName] = useState("");
  const createdBranchName = readCreatedGitRefName(branchName);
  const shouldShowBranchNamePreview =
    branchName.trim().length > 0 && createdBranchName !== branchName.trim();

  useEffect(() => {
    if (branchCreateTarget !== null) {
      setBranchName("");
    }
  }, [branchCreateTarget]);

  const submitBranchName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (branchCreateTarget === null) {
      return;
    }

    await createBranch({ branchCreateTarget, branch: createdBranchName });
  };

  return (
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
                Create a branch for this commit.
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
              <Button type="submit" disabled={createdBranchName.length === 0}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
};

const GitRefCreateDialog = ({
  gitRefCreateTarget,
  createGitRef,
  closeGitRefCreateModal,
}: {
  gitRefCreateTarget: GitRefCreateTarget | null;
  createGitRef: ({
    gitRefCreateTarget,
    name,
  }: {
    gitRefCreateTarget: GitRefCreateTarget;
    name: string;
  }) => Promise<void>;
  closeGitRefCreateModal: () => void;
}) => {
  const [gitRefName, setGitRefName] = useState("");
  const createdGitRefName = readCreatedGitRefName(gitRefName);
  const shouldShowGitRefNamePreview =
    gitRefName.trim().length > 0 && createdGitRefName !== gitRefName.trim();
  const gitRefCreateText =
    gitRefCreateTarget === null
      ? null
      : readGitRefCreateText(gitRefCreateTarget.gitRefType);

  useEffect(() => {
    if (gitRefCreateTarget !== null) {
      setGitRefName("");
    }
  }, [gitRefCreateTarget]);

  const submitGitRefName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (gitRefCreateTarget === null) {
      return;
    }

    await createGitRef({ gitRefCreateTarget, name: createdGitRefName });
  };

  return (
    <Dialog
      open={gitRefCreateTarget !== null}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          return;
        }

        closeGitRefCreateModal();
      }}
    >
      {gitRefCreateTarget === null || gitRefCreateText === null ? null : (
        <DialogContent className="sm:max-w-sm">
          <form className="grid gap-4" onSubmit={submitGitRefName}>
            <DialogHeader>
              <DialogTitle>{gitRefCreateText.title}</DialogTitle>
              <DialogDescription>
                {gitRefCreateText.description}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              aria-label={gitRefCreateText.nameLabel}
              value={gitRefName}
              onChange={(event) => setGitRefName(event.target.value)}
            />
            {shouldShowGitRefNamePreview ? (
              <p className="branch-name-preview">
                {gitRefCreateText.previewLabel}:{" "}
                <code>{createdGitRefName}</code>
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeGitRefCreateModal}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createdGitRefName.length === 0}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
};

const CommitChangesDialog = ({
  commitChangesTarget,
  commitChanges,
  closeCommitChangesModal,
}: {
  commitChangesTarget: CommitChangesTarget | null;
  commitChanges: ({
    commitChangesTarget,
    message,
  }: {
    commitChangesTarget: CommitChangesTarget;
    message: string;
  }) => Promise<void>;
  closeCommitChangesModal: () => void;
}) => {
  const [commitMessage, setCommitMessage] = useState("");

  useEffect(() => {
    if (commitChangesTarget !== null) {
      setCommitMessage("");
    }
  }, [commitChangesTarget]);

  const submitCommitChanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (commitChangesTarget === null) {
      return;
    }

    const createdCommitMessage = commitMessage.trim();
    const message =
      createdCommitMessage.length === 0
        ? commitChangesTarget.fallbackMessage
        : createdCommitMessage;

    await commitChanges({ commitChangesTarget, message });
  };

  return (
    <Dialog
      open={commitChangesTarget !== null}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          return;
        }

        closeCommitChangesModal();
      }}
    >
      {commitChangesTarget === null ? null : (
        <DialogContent className="sm:max-w-sm">
          <form className="grid gap-4" onSubmit={submitCommitChanges}>
            <DialogHeader>
              <DialogTitle>Commit</DialogTitle>
              <DialogDescription>Enter a commit message.</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              placeholder="Optional"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeCommitChangesModal}
              >
                Cancel
              </Button>
              <Button type="submit">Commit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
};

// This dialog gathers the GitHub PR fields while the main process validates the pushed refs again before creating it.
const GitPullRequestCreateDialog = ({
  gitPullRequestCreateTarget,
  createPullRequest,
  closeGitPullRequestCreateModal,
}: {
  gitPullRequestCreateTarget: GitPullRequestCreateTarget | null;
  createPullRequest: ({
    gitPullRequestCreateTarget,
    baseBranch,
    headBranch,
    title,
    description,
  }: {
    gitPullRequestCreateTarget: GitPullRequestCreateTarget;
    baseBranch: string;
    headBranch: string;
    title: string;
    description: string;
  }) => Promise<void>;
  closeGitPullRequestCreateModal: () => void;
}) => {
  const [baseBranch, setBaseBranch] = useState("");
  const [headBranch, setHeadBranch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const createdTitle = title.trim();
  const createdDescription = description.trim();

  useEffect(() => {
    if (gitPullRequestCreateTarget === null) {
      return;
    }

    const nextHeadBranch = gitPullRequestCreateTarget.headBranches[0] ?? "";
    let nextBaseBranch = "";

    if (
      gitPullRequestCreateTarget.defaultBaseBranch !== null &&
      gitPullRequestCreateTarget.defaultBaseBranch !== nextHeadBranch &&
      gitPullRequestCreateTarget.baseBranches.includes(
        gitPullRequestCreateTarget.defaultBaseBranch,
      )
    ) {
      nextBaseBranch = gitPullRequestCreateTarget.defaultBaseBranch;
    }

    if (nextBaseBranch.length === 0) {
      for (const branch of gitPullRequestCreateTarget.baseBranches) {
        if (branch === nextHeadBranch) {
          continue;
        }

        nextBaseBranch = branch;
        break;
      }
    }

    setBaseBranch(nextBaseBranch);
    setHeadBranch(nextHeadBranch);
    setTitle("");
    setDescription("");
  }, [gitPullRequestCreateTarget]);

  const submitPullRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (gitPullRequestCreateTarget === null) {
      return;
    }

    await createPullRequest({
      gitPullRequestCreateTarget,
      baseBranch,
      headBranch,
      title: createdTitle,
      description: createdDescription,
    });
  };

  const isMissingHeadBranch =
    gitPullRequestCreateTarget !== null &&
    gitPullRequestCreateTarget.headBranches.length === 0;
  const isMissingBaseBranch =
    gitPullRequestCreateTarget !== null &&
    gitPullRequestCreateTarget.baseBranches.length === 0;
  const isFormDisabled = isMissingHeadBranch || isMissingBaseBranch;
  const isSameBranch =
    baseBranch.length > 0 && headBranch.length > 0 && baseBranch === headBranch;

  return (
    <Dialog
      open={gitPullRequestCreateTarget !== null}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          return;
        }

        closeGitPullRequestCreateModal();
      }}
    >
      {gitPullRequestCreateTarget === null ? null : (
        <DialogContent className="git-pull-request-modal">
          <form className="grid gap-4" onSubmit={submitPullRequest}>
            <DialogHeader>
              <DialogTitle>Create Pull Request</DialogTitle>
              <DialogDescription>
                Create a pull request on GitHub from a pushed branch at this
                commit.
              </DialogDescription>
            </DialogHeader>
            {isMissingHeadBranch ? (
              <Alert className="git-action-warning" variant="destructive">
                <AlertDescription>
                  You need to push a branch here to start a PR.
                </AlertDescription>
              </Alert>
            ) : null}
            {isMissingBaseBranch ? (
              <Alert className="git-action-warning" variant="destructive">
                <AlertDescription>
                  You need a pushed branch to merge into.
                </AlertDescription>
              </Alert>
            ) : null}
            {isSameBranch ? (
              <Alert className="git-action-warning" variant="destructive">
                <AlertDescription>
                  Choose two different branches for this pull request.
                </AlertDescription>
              </Alert>
            ) : null}
            <label className="git-pull-request-field">
              <span className="git-pull-request-label">Branch to merge</span>
              <NativeSelect
                disabled={isFormDisabled}
                value={headBranch}
                onChange={(event) => setHeadBranch(event.target.value)}
              >
                {gitPullRequestCreateTarget.headBranches.map((branch) => (
                  <NativeSelectOption value={branch} key={branch}>
                    {branch}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="git-pull-request-field">
              <span className="git-pull-request-label">Pull request into</span>
              <NativeSelect
                disabled={isFormDisabled}
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
              >
                {gitPullRequestCreateTarget.baseBranches.map((branch) => (
                  <NativeSelectOption value={branch} key={branch}>
                    {branch}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="git-pull-request-field">
              <span className="git-pull-request-label">Title</span>
              <Input
                autoFocus={!isFormDisabled}
                disabled={isFormDisabled}
                placeholder={gitPullRequestCreateTarget.subject}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="git-pull-request-field">
              <span className="git-pull-request-label">Description</span>
              <textarea
                className="git-pull-request-description"
                disabled={isFormDisabled}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeGitPullRequestCreateModal}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isFormDisabled ||
                  isSameBranch ||
                  baseBranch.length === 0 ||
                  headBranch.length === 0 ||
                  createdTitle.length === 0
                }
              >
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
};

const CommitHistory = ({
  commits,
  branchSyncChanges,
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
}: {
  commits: GitCommit[];
  branchSyncChanges: GitBranchSyncChange[];
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
}) => {
  const commitHistoryRef = useRef<HTMLDivElement | null>(null);
  const commitHistoryHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const columnResizeRef = useRef<CommitHistoryColumnResize | null>(null);
  const [columnWidths, setColumnWidths] = useState<CommitHistoryColumnWidths>(
    COMMIT_HISTORY_INITIAL_COLUMN_WIDTHS,
  );
  const [didResizeGraphColumn, setDidResizeGraphColumn] = useState(false);
  const [shouldShowChatOnly, setShouldShowChatOnly] = useState(false);
  const branchPointerDragRef = useRef<BranchPointerDrag | null>(null);
  const [branchCreateTarget, setBranchCreateTarget] =
    useState<BranchCreateTarget | null>(null);
  const [rowContextMenuTarget, setRowContextMenuTarget] =
    useState<RowContextMenuTarget | null>(null);
  const [copyContextMenuTarget, setCopyContextMenuTarget] =
    useState<CopyContextMenuTarget | null>(null);
  const [gitRefContextMenuTarget, setGitRefContextMenuTarget] =
    useState<GitRefContextMenuTarget | null>(null);
  const [gitRefCreateTarget, setGitRefCreateTarget] =
    useState<GitRefCreateTarget | null>(null);
  const [gitPullRequestCreateTarget, setGitPullRequestCreateTarget] =
    useState<GitPullRequestCreateTarget | null>(null);
  const [commitChangesTarget, setCommitChangesTarget] =
    useState<CommitChangesTarget | null>(null);
  const [rowDiffTarget, setRowDiffTarget] = useState<RowDiffTarget | null>(
    null,
  );
  const [rowDiffLoadState, setRowDiffLoadState] = useState<RowDiffLoadState>({
    type: "loading",
  });
  const [terminalTarget, setTerminalTarget] = useState<TerminalTarget | null>(
    null,
  );
  const [isTerminalBusyOfCwd, setIsTerminalBusyOfCwd] = useState<{
    [cwd: string]: boolean;
  }>({});
  const [gitRefDeleteTarget, setGitRefDeleteTarget] =
    useState<GitRefDeleteTarget | null>(null);
  const [branchMergeConfirmation, setBranchMergeConfirmation] =
    useState<BranchMergeConfirmation | null>(null);
  const [branchPushConfirmation, setBranchPushConfirmation] =
    useState<BranchPushConfirmation | null>(null);
  const [headMoveConfirmation, setHeadMoveConfirmation] =
    useState<HeadMoveConfirmation | null>(null);
  const [branchPointerMove, setBranchPointerMove] =
    useState<BranchPointerMove | null>(null);
  const [branchPointerDropTargetRowId, setBranchPointerDropTargetRowId] =
    useState<string | null>(null);
  const updateTerminalStatusState = useCallback(
    ({ cwd, isBusy }: { cwd: string; isBusy: boolean }) => {
      setIsTerminalBusyOfCwd((currentIsTerminalBusyOfCwd) => {
        if (currentIsTerminalBusyOfCwd[cwd] === isBusy) {
          return currentIsTerminalBusyOfCwd;
        }

        return {
          ...currentIsTerminalBusyOfCwd,
          [cwd]: isBusy,
        };
      });
    },
    [],
  );
  useEffect(() => {
    let isDisposed = false;
    const removeTerminalSessionWatch = window.crabtree.watchTerminalSession(
      (terminalSessionEvent) => {
        switch (terminalSessionEvent.type) {
          case "data":
            return;
          case "status":
            updateTerminalStatusState({
              cwd: terminalSessionEvent.cwd,
              isBusy: terminalSessionEvent.isBusy,
            });
            return;
        }
      },
    );

    void window.crabtree
      .readTerminalSessions()
      .then((terminalSessionSummaries) => {
        if (isDisposed) {
          return;
        }

        const nextIsTerminalBusyOfCwd: { [cwd: string]: boolean } = {};

        for (const terminalSessionSummary of terminalSessionSummaries) {
          nextIsTerminalBusyOfCwd[terminalSessionSummary.cwd] =
            terminalSessionSummary.isBusy;
        }

        setIsTerminalBusyOfCwd(nextIsTerminalBusyOfCwd);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Failed to read terminals.";
        showErrorMessage(message);
      });

    return () => {
      isDisposed = true;
      removeTerminalSessionWatch();
    };
  }, [showErrorMessage, updateTerminalStatusState]);
  useEffect(() => {
    if (
      rowContextMenuTarget === null &&
      copyContextMenuTarget === null &&
      gitRefContextMenuTarget === null
    ) {
      return;
    }

    const closeContextMenus = () => {
      setRowContextMenuTarget(null);
      setCopyContextMenuTarget(null);
      setGitRefContextMenuTarget(null);
    };
    const closeContextMenusAfterEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      closeContextMenus();
    };

    window.addEventListener("mousedown", closeContextMenus);
    window.addEventListener("keydown", closeContextMenusAfterEscape);

    return () => {
      window.removeEventListener("mousedown", closeContextMenus);
      window.removeEventListener("keydown", closeContextMenusAfterEscape);
    };
  }, [copyContextMenuTarget, gitRefContextMenuTarget, rowContextMenuTarget]);
  useLayoutEffect(() => {
    const contextMenu = contextMenuRef.current;
    if (contextMenu === null) {
      return;
    }

    // Keep the right-click menu inside the Electron window after React renders its real size.
    const contextMenuRect = contextMenu.getBoundingClientRect();
    const maxLeft =
      window.innerWidth - contextMenuRect.width - CONTEXT_MENU_WINDOW_MARGIN;
    const maxTop =
      window.innerHeight - contextMenuRect.height - CONTEXT_MENU_WINDOW_MARGIN;
    const left = Math.max(
      CONTEXT_MENU_WINDOW_MARGIN,
      Math.min(contextMenuRect.left, maxLeft),
    );
    const top = Math.max(
      CONTEXT_MENU_WINDOW_MARGIN,
      Math.min(contextMenuRect.top, maxTop),
    );
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
  }, [copyContextMenuTarget, gitRefContextMenuTarget, rowContextMenuTarget]);
  useEffect(() => {
    if (rowDiffTarget === null) {
      return;
    }

    let shouldIgnore = false;

    setRowDiffLoadState({ type: "loading" });

    void window.crabtree
      .readGitDiff(rowDiffTarget.request)
      .then((gitDiff) => {
        if (shouldIgnore) {
          return;
        }

        setRowDiffLoadState({ type: "loaded", files: gitDiff.files });
      })
      .catch((error) => {
        if (shouldIgnore) {
          return;
        }

        setRowDiffLoadState({
          type: "error",
          message: readCaughtUserFacingErrorMessage({
            error,
            fallbackMessage: "Failed to read diff.",
          }),
        });
      });

    return () => {
      shouldIgnore = true;
    };
  }, [rowDiffTarget]);
  const graph = useMemo(
    () =>
      createCommitGraph({
        commits,
        threadOfId,
        mainWorktreePath,
        worktrees,
        gitChangesOfCwd,
      }),
    [commits, gitChangesOfCwd, mainWorktreePath, threadOfId, worktrees],
  );
  const pullRequestBaseBranches = useMemo(
    () => readPushedBranchNames({ commits, defaultBranch }),
    [commits, defaultBranch],
  );
  const headChangeSummary = gitChangesOfCwd[repoRoot];
  const headTotalChangeSummary =
    headChangeSummary === undefined
      ? EMPTY_GIT_CHANGE_SUMMARY
      : headChangeSummary;
  const isHeadClean =
    headChangeSummary !== undefined &&
    readIsGitChangeSummaryEmpty(headTotalChangeSummary);
  const mergeability = useMemo(() => {
    const commitOfSha: { [sha: string]: GitCommit } = {};
    const branchShaOfBranch: { [branch: string]: string } = {};
    const isShaReachableFromHead: { [sha: string]: boolean } = {};
    const nextIsBranchMergeableOfBranch: { [branch: string]: boolean } = {};
    const nextIsCommitMergeableOfSha: { [sha: string]: boolean } = {};
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
      return {
        isBranchMergeableOfBranch: nextIsBranchMergeableOfBranch,
        isCommitMergeableOfSha: nextIsCommitMergeableOfSha,
      };
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

    for (const commit of commits) {
      nextIsCommitMergeableOfSha[commit.sha] =
        isShaReachableFromHead[commit.sha] !== true;
    }

    return {
      isBranchMergeableOfBranch: nextIsBranchMergeableOfBranch,
      isCommitMergeableOfSha: nextIsCommitMergeableOfSha,
    };
  }, [commits, currentBranch]);
  const { isBranchMergeableOfBranch, isCommitMergeableOfSha } = mergeability;
  const isBranchNameUsedOfBranch = useMemo(() => {
    const nextIsBranchNameUsedOfBranch: { [branch: string]: boolean } = {};
    const addBranchName = (branch: string) => {
      nextIsBranchNameUsedOfBranch[branch] = true;
      nextIsBranchNameUsedOfBranch[branch.toLowerCase()] = true;
    };

    if (currentBranch !== null) {
      addBranchName(currentBranch);
    }

    for (const worktree of worktrees) {
      if (worktree.branch !== null) {
        addBranchName(worktree.branch);
      }
    }

    for (const commit of commits) {
      for (const localBranch of commit.localBranches) {
        addBranchName(localBranch);
      }
    }

    return nextIsBranchNameUsedOfBranch;
  }, [commits, currentBranch, worktrees]);
  const isCommitMessageUsedOfMessage = useMemo(() => {
    const nextIsCommitMessageUsedOfMessage: { [message: string]: boolean } = {};

    for (const commit of commits) {
      nextIsCommitMessageUsedOfMessage[commit.subject] = true;
    }

    return nextIsCommitMessageUsedOfMessage;
  }, [commits]);
  // Deletion stays available for every local branch and tag. These messages explain risky deletes in the modal.
  const gitRefDeleteWarnings = useMemo(() => {
    const commitOfSha: { [sha: string]: GitCommit } = {};
    const branchShaOfBranch: { [branch: string]: string } = {};
    const tagShaOfTag: { [tag: string]: string } = {};
    const checkedOutBranchOfBranch: { [branch: string]: boolean } = {};
    const rootShas: {
      sha: string;
      ignoredRefKey: string | null;
    }[] = [];

    const readBranchRefKey = (branch: string) => `refs/heads/${branch}`;
    const readTagRefKey = (tag: string) => `refs/tags/${tag}`;
    const pushRootSha = ({
      sha,
      ignoredRefKey,
    }: {
      sha: string;
      ignoredRefKey: string | null;
    }) => {
      rootShas.push({ sha, ignoredRefKey });
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
    const readIsShaVisibleAfterDelete = ({
      sha,
      deletedRefKey,
    }: {
      sha: string;
      deletedRefKey: string;
    }) => {
      const isReachableSha: { [sha: string]: boolean } = {};

      for (const root of rootShas) {
        if (root.ignoredRefKey === deletedRefKey) {
          continue;
        }

        pushReachableShas({
          startSha: root.sha,
          isReachableSha,
        });
      }

      return isReachableSha[sha] === true;
    };
    const readWarningMessage = (reasons: string[]) => {
      if (reasons.length === 0) {
        return null;
      }

      return `We don't recommend deleting this because ${readGitWarningReasonText(reasons)}.`;
    };

    // First collect the commits and local branches.
    for (const commit of commits) {
      commitOfSha[commit.sha] = commit;

      for (const localBranch of commit.localBranches) {
        branchShaOfBranch[localBranch] = commit.sha;
      }
    }

    for (const worktree of worktrees) {
      if (worktree.branch !== null) {
        checkedOutBranchOfBranch[worktree.branch] = true;
      }
    }

    // Then collect the refs that would keep commits visible.
    for (const commit of commits) {
      for (const localBranch of commit.localBranches) {
        pushRootSha({
          sha: commit.sha,
          ignoredRefKey: readBranchRefKey(localBranch),
        });
      }

      for (const ref of commit.refs) {
        if (ref.startsWith("HEAD -> ")) {
          continue;
        }

        if (ref.startsWith("tag: ")) {
          const tag = cleanRefName(ref);

          tagShaOfTag[tag] = commit.sha;
          pushRootSha({ sha: commit.sha, ignoredRefKey: readTagRefKey(tag) });
          continue;
        }

        const refName = cleanRefName(ref);

        if (commit.localBranches.includes(refName)) {
          continue;
        }

        if (refName.startsWith("origin/")) {
          continue;
        }

        pushRootSha({ sha: commit.sha, ignoredRefKey: null });
      }
    }

    // Finally explain each branch or tag that loses a useful Git anchor when deleted.
    const deleteWarningMessageOfBranch: { [branch: string]: string } = {};
    const deleteWarningMessageOfTag: { [tag: string]: string } = {};
    const shouldBlockDeleteOfBranch: { [branch: string]: boolean } = {};

    for (const branch of Object.keys(branchShaOfBranch)) {
      const reasons: string[] = [];

      if (checkedOutBranchOfBranch[branch] === true) {
        shouldBlockDeleteOfBranch[branch] = true;
        deleteWarningMessageOfBranch[branch] = CHECKED_OUT_BY_WORKTREE_MESSAGE;
        continue;
      }

      if (branch === defaultBranch) {
        shouldBlockDeleteOfBranch[branch] = true;
        deleteWarningMessageOfBranch[branch] =
          "This is the default branch, so you can't delete it.";
        continue;
      }

      if (
        !readIsShaVisibleAfterDelete({
          sha: branchShaOfBranch[branch],
          deletedRefKey: readBranchRefKey(branch),
        })
      ) {
        reasons.push("it's the only thing keeping this commit in the graph");
      }

      const warningMessage = readWarningMessage(reasons);

      if (warningMessage !== null) {
        deleteWarningMessageOfBranch[branch] = warningMessage;
      }
    }

    for (const tag of Object.keys(tagShaOfTag)) {
      const reasons = [TAG_STABILITY_WARNING_REASON];
      const warningMessage = readWarningMessage(reasons);

      if (warningMessage !== null) {
        deleteWarningMessageOfTag[tag] = warningMessage;
      }
    }

    return {
      deleteWarningMessageOfBranch,
      deleteWarningMessageOfTag,
      shouldBlockDeleteOfBranch,
    };
  }, [commits, defaultBranch, worktrees]);
  const duplicateCheckedOutBranchOfBranch = useMemo(() => {
    return readDuplicateCheckedOutBranchOfBranch({
      currentBranch,
      worktrees,
    });
  }, [currentBranch, worktrees]);
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
  const readBranchPointerMoveWarningMessage = ({
    branch,
    oldSha,
    newSha,
  }: {
    branch: string;
    oldSha: string;
    newSha: string;
  }) => {
    const reasons: string[] = [];
    let isVisibleAfterMove = readIsAncestorInVisibleGraph({
      ancestorSha: oldSha,
      descendantSha: newSha,
    });

    for (const commit of commits) {
      for (const localBranch of commit.localBranches) {
        if (
          !isVisibleAfterMove &&
          localBranch !== branch &&
          readIsAncestorInVisibleGraph({
            ancestorSha: oldSha,
            descendantSha: commit.sha,
          })
        ) {
          isVisibleAfterMove = true;
        }
      }

      for (const ref of commit.refs) {
        if (
          !isVisibleAfterMove &&
          (ref === "HEAD" || ref.startsWith("tag: ")) &&
          readIsAncestorInVisibleGraph({
            ancestorSha: oldSha,
            descendantSha: commit.sha,
          })
        ) {
          isVisibleAfterMove = true;
        }
      }
    }

    if (!isVisibleAfterMove) {
      reasons.push("it's the only thing keeping this commit in the graph");
    }

    if (reasons.length === 0) {
      return null;
    }

    return `We don't recommend moving this because ${readGitWarningReasonText(reasons)}.`;
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
  const readHeadMoveTargetText = ({ row }: { row: CommitGraphRow }) => {
    const branch = row.commit.localBranches[0];

    if (branch !== undefined) {
      return branch;
    }

    return row.commit.shortSha;
  };
  const visibleGraph = useMemo(() => {
    if (!shouldShowChatOnly) {
      return graph;
    }

    const rows: CommitGraphRow[] = [];
    const rowIndexOfOldRowIndex: { [rowIndex: number]: number } = {};

    for (const row of graph.rows) {
      if (
        !readShouldShowChatOnlyCommitGraphRow({
          refs: row.commit.refs,
          threadIds: row.threadIds,
          isChangedWorkingTreeRow: row.threadGroup !== null,
        })
      ) {
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
  const visibleGraphWithHeadDot = useMemo(() => {
    const rows = visibleGraph.rows.map((row) => {
      const shouldShowHeadDot =
        mainWorktreeHeadOwnerRowId === null
          ? row.shouldShowHeadDot
          : row.id === mainWorktreeHeadOwnerRowId;

      if (row.shouldShowHeadDot === shouldShowHeadDot) {
        return row;
      }

      return { ...row, shouldShowHeadDot };
    });

    return {
      ...visibleGraph,
      rows,
    };
  }, [mainWorktreeHeadOwnerRowId, visibleGraph]);

  const graphMinimumWidth = readCommitGraphWidth({
    laneCount: visibleGraphWithHeadDot.laneCount,
  });
  const graphInitialWidth = Math.max(
    graphMinimumWidth,
    Math.min(
      graphMinimumWidth + COMMIT_GRAPH_INITIAL_EXTRA_WIDTH,
      COMMIT_GRAPH_MAX_INITIAL_WIDTH,
    ),
  );
  const visibleColumnWidths: CommitHistoryColumnWidths = {
    ...columnWidths,
    graph: Math.max(
      columnWidths.graph,
      didResizeGraphColumn ? graphMinimumWidth : graphInitialWidth,
    ),
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
    setDidResizeGraphColumn(true);
  };
  const startBranchPointerDrag = ({
    event,
    gitRefType,
    refName,
    sourcePath,
    oldSha,
    oldShortSha,
    oldSubject,
  }: {
    event: DragEvent<HTMLElement>;
    gitRefType: "branch" | "tag" | "head";
    refName: string;
    sourcePath: string | null;
    oldSha: string;
    oldShortSha: string;
    oldSubject: string;
  }) => {
    const nextBranchPointerDrag = {
      repoRoot,
      gitRefType,
      refName,
      sourcePath,
      oldSha,
      oldShortSha,
      oldSubject,
    };

    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", refName);
    branchPointerDragRef.current = nextBranchPointerDrag;
    setBranchPointerDropTargetRowId(null);
    trackDesktopAction({
      eventName:
        gitRefType === "head"
          ? "head_dragged"
          : gitRefType === "branch"
            ? "branch_dragged"
            : "tag_dragged",
      properties: {},
    });
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

    if (activeBranchPointerDrag.gitRefType === "head") {
      if (activeBranchPointerDrag.repoRoot !== repoRoot || !row.isCommitRow) {
        setBranchPointerDropTargetRowId(null);
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setBranchPointerDropTargetRowId(row.id);
      return;
    }

    const branchPointerTarget = readBranchPointerTarget({ row });
    const isDirtyWorktreeTarget =
      !row.isCommitRow && branchPointerTarget.path !== null;
    const branchPointerTargetPath = isDirtyWorktreeTarget
      ? branchPointerTarget.path
      : row.shouldShowHeadDot
        ? mainWorktreePath
        : null;
    const isSameBranchPointerPlace =
      activeBranchPointerDrag.oldSha === branchPointerTarget.sha &&
      (activeBranchPointerDrag.gitRefType === "tag" ||
        activeBranchPointerDrag.sourcePath === branchPointerTargetPath);

    if (
      activeBranchPointerDrag.repoRoot !== repoRoot ||
      (!row.isCommitRow && !isDirtyWorktreeTarget) ||
      isSameBranchPointerPlace
    ) {
      setBranchPointerDropTargetRowId(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setBranchPointerDropTargetRowId(row.id);
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

    if (activeBranchPointerDrag.gitRefType === "head") {
      if (activeBranchPointerDrag.repoRoot !== repoRoot || !row.isCommitRow) {
        finishBranchPointerDrag();
        return;
      }

      finishBranchPointerDrag();
      setHeadMoveConfirmation({
        row,
        targetText: readHeadMoveTargetText({ row }),
      });
      return;
    }

    const branchPointerTarget = readBranchPointerTarget({ row });
    const isDirtyWorktreeTarget =
      !row.isCommitRow && branchPointerTarget.path !== null;
    const branchPointerTargetPath = isDirtyWorktreeTarget
      ? branchPointerTarget.path
      : row.shouldShowHeadDot
        ? mainWorktreePath
        : null;
    const isSameBranchPointerPlace =
      activeBranchPointerDrag.oldSha === branchPointerTarget.sha &&
      (activeBranchPointerDrag.gitRefType === "tag" ||
        activeBranchPointerDrag.sourcePath === branchPointerTargetPath);

    if (
      activeBranchPointerDrag.repoRoot !== repoRoot ||
      (!row.isCommitRow && !isDirtyWorktreeTarget) ||
      isSameBranchPointerPlace
    ) {
      finishBranchPointerDrag();
      return;
    }

    const warningMessage =
      activeBranchPointerDrag.gitRefType === "tag"
        ? `We don't recommend moving this because ${TAG_STABILITY_WARNING_REASON}.`
        : readBranchPointerMoveWarningMessage({
            branch: activeBranchPointerDrag.refName,
            oldSha: activeBranchPointerDrag.oldSha,
            newSha: branchPointerTarget.sha,
          });

    setBranchPointerMove({
      repoRoot,
      gitRefType: activeBranchPointerDrag.gitRefType,
      refName: activeBranchPointerDrag.refName,
      oldSha: activeBranchPointerDrag.oldSha,
      oldShortSha: activeBranchPointerDrag.oldShortSha,
      oldSubject: activeBranchPointerDrag.oldSubject,
      newSha: branchPointerTarget.sha,
      newShortSha: branchPointerTarget.shortSha,
      newSubject: branchPointerTarget.subject,
      sourcePath: activeBranchPointerDrag.sourcePath,
      targetPath: branchPointerTargetPath,
      warningMessage,
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
  const openGitRefDeleteModal = (
    event: MouseEvent<Element>,
    gitRefType: "branch" | "tag",
    name: string,
    oldSha: string,
    warningMessage: string | null,
    shouldBlockDelete: boolean,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setGitRefContextMenuTarget(null);
    setGitRefDeleteTarget({
      gitRefType,
      name,
      oldSha,
      warningMessage,
      shouldBlockDelete,
    });
  };
  const closeGitRefDeleteModal = () => {
    setGitRefDeleteTarget(null);
  };
  const openBranchCreateModal = (
    event: MouseEvent<HTMLButtonElement>,
    branchCreateTarget: BranchCreateTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setBranchCreateTarget(branchCreateTarget);
  };
  const closeBranchCreateModal = () => {
    setBranchCreateTarget(null);
  };
  const openRowContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    row: CommitGraphRow,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setCopyContextMenuTarget(null);
    setGitRefContextMenuTarget(null);
    const gitDiffRowTarget: GitDiffRequest["target"] =
      row.threadGroup !== null && row.threadGroup.cwd.length > 0
        ? { type: "path", path: row.threadGroup.cwd }
        : { type: "commit", repoRoot, sha: row.commit.sha };
    const gitDiffDescription =
      row.threadGroup !== null && row.threadGroup.cwd.length > 0
        ? row.threadGroup.cwd
        : `${row.commit.shortSha} ${row.commit.subject}`;
    const gitDiffAgainstHeadDescription =
      row.threadGroup !== null && row.threadGroup.cwd.length > 0
        ? `${row.threadGroup.cwd} vs HEAD`
        : `HEAD vs ${row.commit.shortSha} ${row.commit.subject}`;
    const readRowDiffTarget = (mode: GitDiffRequest["mode"]): RowDiffTarget => {
      return {
        title:
          mode === "changesMadeHere" ? "See changes here" : "Diff against HEAD",
        description:
          mode === "changesMadeHere"
            ? gitDiffDescription
            : gitDiffAgainstHeadDescription,
        repositoryPath: null,
        request: {
          mode,
          target: gitDiffRowTarget,
        },
      };
    };

    setRowContextMenuTarget({
      sha: row.isCommitRow ? row.commit.sha : null,
      isEnabled: row.isCommitRow,
      pullRequestTarget: row.isCommitRow
        ? {
            sha: row.commit.sha,
            subject: row.commit.subject,
            baseBranches: pullRequestBaseBranches,
            headBranches: readPushedBranchNamesForCommit(row.commit),
            defaultBaseBranch: defaultBranch,
          }
        : null,
      changesMadeHereTarget: readRowDiffTarget("changesMadeHere"),
      diffAgainstHeadTarget: readRowDiffTarget("diffAgainstHead"),
      x: event.clientX,
      y: event.clientY,
    });
  };
  const openCopyContextMenu = (
    event: MouseEvent<Element>,
    text: string,
    errorMessage: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setRowContextMenuTarget(null);
    setGitRefContextMenuTarget(null);
    setCopyContextMenuTarget({
      text,
      errorMessage,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const openGitRefContextMenu = (
    event: MouseEvent<Element>,
    gitRefContextMenuTarget: Omit<GitRefContextMenuTarget, "x" | "y">,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setRowContextMenuTarget(null);
    setCopyContextMenuTarget(null);
    setGitRefContextMenuTarget({
      ...gitRefContextMenuTarget,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const copyContextMenuText = async (target: CopyContextMenuTarget) => {
    setCopyContextMenuTarget(null);
    await copyText({
      text: target.text,
      errorMessage: target.errorMessage,
    });
  };
  const copyGitRefContextMenuText = async (target: GitRefContextMenuTarget) => {
    setGitRefContextMenuTarget(null);
    await copyText({
      text: target.name,
      errorMessage:
        target.gitRefType === "branch"
          ? "Failed to copy branch name."
          : "Failed to copy tag name.",
    });
  };
  const openRowDiffModal = (rowDiffTarget: RowDiffTarget) => {
    setRowContextMenuTarget(null);
    setRowDiffTarget(rowDiffTarget);
    trackDesktopAction({
      eventName: "row_diff_opened",
      properties: {
        mode: rowDiffTarget.request.mode,
        target_type: rowDiffTarget.request.target.type,
      },
    });
  };
  const closeRowDiffModal = () => {
    setRowDiffTarget(null);
    setRowDiffLoadState({ type: "loading" });
  };
  const openGitRefCreateModal = (gitRefType: "branch" | "tag") => {
    if (rowContextMenuTarget === null || rowContextMenuTarget.sha === null) {
      return;
    }

    setGitRefCreateTarget({
      gitRefType,
      sha: rowContextMenuTarget.sha,
    });
    setRowContextMenuTarget(null);
  };
  const closeGitRefCreateModal = () => {
    setGitRefCreateTarget(null);
  };
  const openGitPullRequestCreateModal = () => {
    if (
      rowContextMenuTarget === null ||
      rowContextMenuTarget.pullRequestTarget === null
    ) {
      return;
    }

    setGitPullRequestCreateTarget(rowContextMenuTarget.pullRequestTarget);
    setRowContextMenuTarget(null);
  };
  const closeGitPullRequestCreateModal = () => {
    setGitPullRequestCreateTarget(null);
  };
  const openCommitChangesModal = (
    event: MouseEvent<HTMLButtonElement>,
    commitChangesTarget: CommitChangesTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setCommitChangesTarget(commitChangesTarget);
  };
  const closeCommitChangesModal = () => {
    setCommitChangesTarget(null);
  };
  const openChangesDiffModal = (
    event: MouseEvent<HTMLButtonElement>,
    rowDiffTarget: RowDiffTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setRowDiffTarget(rowDiffTarget);
    trackDesktopAction({
      eventName: "change_summary_opened",
      properties: {},
    });
  };
  const openTerminalModal = (
    event: MouseEvent<HTMLButtonElement>,
    cwd: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setTerminalTarget({ cwd });
    trackDesktopAction({
      eventName: "terminal_opened",
      properties: { source: "commit_history" },
    });
  };
  const closeTerminalModal = () => {
    setTerminalTarget(null);
  };
  const closeBranchMergeConfirmationModal = () => {
    setBranchMergeConfirmation(null);
  };
  const closeHeadMoveConfirmationModal = () => {
    setHeadMoveConfirmation(null);
  };
  const closeBranchPointerMoveModal = () => {
    setBranchPointerMove(null);
  };
  const createBranch = async ({
    branchCreateTarget,
    branch,
  }: {
    branchCreateTarget: BranchCreateTarget;
    branch: string;
  }) => {
    await runUserGitUpdateThenRefreshDashboard(
      "Creating branch",
      "Created branch.",
      async () => {
        try {
          await window.crabtree.createGitRef({
            repoRoot: branchCreateTarget.repoRoot,
            gitRefType: "branch",
            name: branch,
            sha: branchCreateTarget.sha,
          });
          trackDesktopAction({
            eventName: "branch_created",
            properties: { target_type: "commit" },
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
  const commitChanges = async ({
    commitChangesTarget,
    message,
  }: {
    commitChangesTarget: CommitChangesTarget;
    message: string;
  }) => {
    const shouldCreateBranch =
      commitChangesTarget.type === "createBranchAndCommit";

    await runUserGitUpdateThenRefreshDashboard(
      shouldCreateBranch
        ? "Creating branch and committing changes"
        : "Committing changes",
      shouldCreateBranch
        ? "Created branch and committed changes."
        : "Committed changes.",
      async () => {
        try {
          if (commitChangesTarget.type === "createBranchAndCommit") {
            await window.crabtree.createGitBranch({
              path: commitChangesTarget.path,
              branch: commitChangesTarget.branch,
              expectedHeadSha: commitChangesTarget.expectedHeadSha,
            });
            trackDesktopAction({
              eventName: "branch_created",
              properties: { target_type: "path" },
            });
          }

          const newSha = await window.crabtree.commitAllGitChanges({
            path: commitChangesTarget.path,
            message,
          });

          if (commitChangesTarget.type === "commit") {
            try {
              await window.crabtree.moveGitBranch({
                repoRoot,
                branch: commitChangesTarget.branchTarget.branch,
                oldSha: commitChangesTarget.branchTarget.oldSha,
                newSha,
                sourcePath: null,
                targetPath: null,
              });
            } catch {
              // The commit already succeeded, so a stale branch tag should not turn it into an error.
            }
          }

          trackDesktopAction({
            eventName: "changes_committed",
            properties: {
              did_move_branch: commitChangesTarget.type === "commit",
            },
          });
          closeCommitChangesModal();
        } catch (error) {
          return error instanceof Error
            ? error.message
            : shouldCreateBranch
              ? "Failed to create branch and commit changes."
              : "Failed to commit changes.";
        }

        return null;
      },
    );
  };
  const createGitRef = async ({
    gitRefCreateTarget,
    name,
  }: {
    gitRefCreateTarget: GitRefCreateTarget;
    name: string;
  }) => {
    const gitRefCreateText = readGitRefCreateText(
      gitRefCreateTarget.gitRefType,
    );
    await runUserGitUpdateThenRefreshDashboard(
      gitRefCreateText.loadingDescription,
      gitRefCreateText.successMessage,
      async () => {
        try {
          await window.crabtree.createGitRef({
            repoRoot,
            gitRefType: gitRefCreateTarget.gitRefType,
            name,
            sha: gitRefCreateTarget.sha,
          });
          trackDesktopAction({
            eventName:
              gitRefCreateTarget.gitRefType === "branch"
                ? "branch_created"
                : "tag_created",
            properties: { target_type: "commit" },
          });
          closeGitRefCreateModal();
        } catch (error) {
          return error instanceof Error
            ? error.message
            : gitRefCreateText.errorMessage;
        }

        return null;
      },
    );
  };
  const createPullRequest = async ({
    gitPullRequestCreateTarget,
    baseBranch,
    headBranch,
    title,
    description,
  }: {
    gitPullRequestCreateTarget: GitPullRequestCreateTarget;
    baseBranch: string;
    headBranch: string;
    title: string;
    description: string;
  }) => {
    let pullRequestUrl: string | null = null;

    await runUserGitUpdateThenRefreshDashboard(
      "Creating pull request",
      "Created pull request.",
      async () => {
        try {
          pullRequestUrl = await window.crabtree.createGitPullRequest({
            repoRoot,
            baseBranch,
            headBranch,
            headSha: gitPullRequestCreateTarget.sha,
            title,
            description,
          });
          trackDesktopAction({
            eventName: "pull_request_created",
            properties: {
              has_description: description.length > 0,
              source: "commit_context_menu",
            },
          });
          closeGitPullRequestCreateModal();
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Failed to create pull request.";
        }

        return null;
      },
    );

    if (pullRequestUrl === null) {
      return;
    }

    try {
      await window.crabtree.openExternalUrl(pullRequestUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open pull request.";
      showErrorMessage(message);
    }
  };
  const deleteSelectedGitRef = async () => {
    if (gitRefDeleteTarget === null) {
      return;
    }

    const deleteTarget = gitRefDeleteTarget;
    closeGitRefDeleteModal();

    await runUserGitUpdateThenRefreshDashboard(
      deleteTarget.gitRefType === "branch" ? "Deleting branch" : "Deleting tag",
      deleteTarget.gitRefType === "branch" ? "Deleted branch." : "Deleted tag.",
      async () => {
        try {
          switch (deleteTarget.gitRefType) {
            case "branch":
              await window.crabtree.deleteGitBranch({
                repoRoot,
                branch: deleteTarget.name,
                oldSha: deleteTarget.oldSha,
              });
              break;
            case "tag":
              await window.crabtree.deleteGitTag({
                repoRoot,
                tag: deleteTarget.name,
                oldSha: deleteTarget.oldSha,
              });
              break;
          }
          trackDesktopAction({
            eventName:
              deleteTarget.gitRefType === "branch"
                ? "branch_deleted"
                : "tag_deleted",
            properties: { had_warning: deleteTarget.warningMessage !== null },
          });
        } catch (error) {
          return error instanceof Error
            ? error.message
            : deleteTarget.gitRefType === "branch"
              ? "Failed to delete branch."
              : "Failed to delete tag.";
        }

        return null;
      },
    );
  };
  const openCodePath = async (path: string) => {
    try {
      await window.crabtree.openPath({ path, launcher: pathLauncher });
      trackDesktopAction({
        eventName: "repo_opened",
        properties: { launcher: pathLauncher, source: "commit_history" },
      });
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

    if (currentBranch === null) {
      return;
    }

    try {
      const preview = await window.crabtree.previewGitMerge({
        repoRoot,
        branch,
      });
      setBranchMergeConfirmation({
        branch,
        targetBranch: currentBranch,
        preview,
      });
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
          await window.crabtree.mergeGitBranch({
            repoRoot,
            branch: request.branch,
          });
          trackDesktopAction({
            eventName: "branch_merged",
            properties: {
              added_lines: request.preview.added,
              removed_lines: request.preview.removed,
              conflict_count: request.preview.conflictCount,
            },
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
  const openBranchPushModal = (
    event: MouseEvent<HTMLButtonElement>,
    branchSyncChanges: GitBranchSyncChange[],
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (branchSyncChanges.length === 0) {
      return;
    }

    setBranchPushConfirmation({ branchSyncChanges });
  };
  const closeBranchPushModal = () => {
    setBranchPushConfirmation(null);
  };
  const confirmBranchPushChange = async () => {
    if (branchPushConfirmation === null) {
      return;
    }

    const { branchSyncChanges } = branchPushConfirmation;
    closeBranchPushModal();

    await runUserGitUpdateThenRefreshDashboard(
      "Pushing",
      "Pushed.",
      async () => {
        try {
          await window.crabtree.pushGitBranchSyncChanges(branchSyncChanges);
          trackDesktopAction({
            eventName: "branches_pushed",
            properties: {
              change_count: branchSyncChanges.length,
              source: "commit_graph",
            },
          });
        } catch (error) {
          return error instanceof Error ? error.message : "Failed to push.";
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
    const branchPointerOperationText = readBranchPointerOperationText({
      gitRefType: request.gitRefType,
      refName: request.refName,
    });

    closeBranchPointerMoveModal();

    await runUserGitUpdateThenRefreshDashboard(
      branchPointerOperationText.loadingDescription,
      branchPointerOperationText.successMessage,
      async () => {
        try {
          if (request.gitRefType === "branch") {
            await window.crabtree.moveGitBranch({
              repoRoot: request.repoRoot,
              branch: request.refName,
              oldSha: request.oldSha,
              newSha: request.newSha,
              sourcePath: request.sourcePath,
              targetPath: request.targetPath,
            });
          } else {
            await window.crabtree.moveGitTag({
              repoRoot: request.repoRoot,
              tag: request.refName,
              oldSha: request.oldSha,
              newSha: request.newSha,
            });
          }
          trackDesktopAction({
            eventName:
              request.gitRefType === "branch" ? "branch_moved" : "tag_moved",
            properties: { had_warning: request.warningMessage !== null },
          });
        } catch (error) {
          return error instanceof Error
            ? error.message
            : request.gitRefType === "branch"
              ? "Failed to update branch."
              : "Failed to update tag.";
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
          await window.crabtree.checkoutGitCommit({
            repoRoot,
            sha: row.commit.sha,
          });
          trackDesktopAction({
            eventName: "head_switched",
            properties: {
              target_type:
                row.commit.localBranches.length > 0 ? "branch" : "commit",
            },
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
  const moveHeadToConfirmationTarget = async () => {
    if (headMoveConfirmation === null) {
      return;
    }

    const request = headMoveConfirmation;
    closeHeadMoveConfirmationModal();
    await openRowAfterDoubleClick(request.row);
  };

  const branchPointerOperationText =
    branchPointerMove === null
      ? null
      : readBranchPointerOperationText({
          gitRefType: branchPointerMove.gitRefType,
          refName: branchPointerMove.refName,
        });
  const branchPushWarningMessages =
    branchPushConfirmation === null
      ? []
      : readBranchSyncPushWarningMessages({
          branchSyncChanges: branchPushConfirmation.branchSyncChanges,
          commits,
        });
  let branchPushConfirmationDescription: ReactNode = "";

  if (branchPushConfirmation !== null) {
    branchPushConfirmationDescription = `Push local ${readBranchSyncChangeTypeText(branchPushConfirmation.branchSyncChanges)} changes to origin?`;
  }
  return (
    <>
      {rowContextMenuTarget === null ? null : (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: rowContextMenuTarget.x,
            top: rowContextMenuTarget.y,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            disabled={!rowContextMenuTarget.isEnabled}
            onClick={() => openGitRefCreateModal("branch")}
          >
            <LuGitBranchPlus size={10} strokeWidth={1.75} />
            <span>Add branch</span>
          </Button>
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            disabled={!rowContextMenuTarget.isEnabled}
            onClick={() => openGitRefCreateModal("tag")}
          >
            <Tag size={10} strokeWidth={1.75} />
            <span>Add tag</span>
          </Button>
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            disabled={!rowContextMenuTarget.isEnabled}
            onClick={openGitPullRequestCreateModal}
          >
            <LuGitPullRequestArrow size={10} strokeWidth={1.75} />
            <span>Add pull request</span>
          </Button>
          <div className="context-menu-separator" />
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            onClick={() =>
              openRowDiffModal(rowContextMenuTarget.changesMadeHereTarget)
            }
          >
            <FileDiff size={10} strokeWidth={1.75} />
            <span>See changes here</span>
          </Button>
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            onClick={() =>
              openRowDiffModal(rowContextMenuTarget.diffAgainstHeadTarget)
            }
          >
            <GitCompareArrows size={10} strokeWidth={1.75} />
            <span>Diff against HEAD</span>
          </Button>
        </div>
      )}
      {copyContextMenuTarget === null ? null : (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: copyContextMenuTarget.x,
            top: copyContextMenuTarget.y,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              void copyContextMenuText(copyContextMenuTarget);
            }}
          >
            <Copy size={10} strokeWidth={1.75} />
            <span>Copy</span>
          </Button>
        </div>
      )}
      {gitRefContextMenuTarget === null ? null : (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: gitRefContextMenuTarget.x,
            top: gitRefContextMenuTarget.y,
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              void copyGitRefContextMenuText(gitRefContextMenuTarget);
            }}
          >
            <Copy size={10} strokeWidth={1.75} />
            <span>Copy</span>
          </Button>
          <Button
            className="context-menu-item"
            variant="ghost"
            size="sm"
            type="button"
            onClick={(event) =>
              openGitRefDeleteModal(
                event,
                gitRefContextMenuTarget.gitRefType,
                gitRefContextMenuTarget.name,
                gitRefContextMenuTarget.oldSha,
                gitRefContextMenuTarget.warningMessage,
                gitRefContextMenuTarget.shouldBlockDelete,
              )
            }
          >
            <Trash2 size={10} strokeWidth={1.75} />
            <span>Delete</span>
          </Button>
        </div>
      )}
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
                  const nextShouldShowChatOnly = !shouldShowChatOnly;
                  setShouldShowChatOnly(nextShouldShowChatOnly);
                  trackDesktopAction({
                    eventName: "codex_chats_filter_changed",
                    properties: { is_enabled: nextShouldShowChatOnly },
                  });
                }}
              >
                Code
              </Button>
              <CommitHistoryColumnResizeHandle
                columnKey="actors"
                startColumnResize={startColumnResize}
                updateColumnResize={updateColumnResize}
                finishColumnResize={finishColumnResize}
              />
            </div>
            <div className="commit-history-header-cell">
              <span>Branches</span>
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
            <CommitGraphSvg
              graph={visibleGraphWithHeadDot}
              graphWidth={graphWidth}
            />
            {visibleGraphWithHeadDot.rows.map((row) => (
              <CommitHistoryRow
                key={row.id}
                row={row}
                branchSyncChanges={branchSyncChanges}
                repoRoot={repoRoot}
                mainWorktreePath={mainWorktreePath}
                worktrees={worktrees}
                currentBranch={currentBranch}
                isHeadClean={isHeadClean}
                threadOfId={threadOfId}
                gitChangesOfCwd={gitChangesOfCwd}
                isBranchNameUsedOfBranch={isBranchNameUsedOfBranch}
                isCommitMessageUsedOfMessage={isCommitMessageUsedOfMessage}
                pathLauncher={pathLauncher}
                isTerminalBusyOfCwd={isTerminalBusyOfCwd}
                duplicateCheckedOutBranchOfBranch={
                  duplicateCheckedOutBranchOfBranch
                }
                isBranchPointerDropTarget={
                  branchPointerDropTargetRowId === row.id
                }
                isBranchMergeableOfBranch={isBranchMergeableOfBranch}
                isCommitMergeableOfSha={isCommitMergeableOfSha}
                deleteWarningMessageOfBranch={
                  gitRefDeleteWarnings.deleteWarningMessageOfBranch
                }
                deleteWarningMessageOfTag={
                  gitRefDeleteWarnings.deleteWarningMessageOfTag
                }
                shouldBlockDeleteOfBranch={
                  gitRefDeleteWarnings.shouldBlockDeleteOfBranch
                }
                updateBranchPointerDropTarget={(event) =>
                  updateBranchPointerDropTarget({ event, row })
                }
                clearBranchPointerDropTarget={clearBranchPointerDropTarget}
                finishBranchPointerDrop={(event) =>
                  finishBranchPointerDrop({ event, row })
                }
                openRowContextMenu={openRowContextMenu}
                openRowAfterDoubleClick={() => openRowAfterDoubleClick(row)}
                openBranchCreateModal={openBranchCreateModal}
                openCommitChangesModal={openCommitChangesModal}
                openChangesDiffModal={openChangesDiffModal}
                openBranchMergeModal={openBranchMergeModal}
                openBranchPushModal={openBranchPushModal}
                openCopyContextMenu={openCopyContextMenu}
                openGitRefContextMenu={openGitRefContextMenu}
                openCodePath={openCodePath}
                openTerminalModal={openTerminalModal}
                showErrorMessage={showErrorMessage}
                startBranchPointerDrag={startBranchPointerDrag}
                finishBranchPointerDrag={finishBranchPointerDrag}
              />
            ))}
          </div>
        </div>
        <BranchCreateDialog
          branchCreateTarget={branchCreateTarget}
          createBranch={createBranch}
          closeBranchCreateModal={closeBranchCreateModal}
        />
        <GitRefCreateDialog
          gitRefCreateTarget={gitRefCreateTarget}
          createGitRef={createGitRef}
          closeGitRefCreateModal={closeGitRefCreateModal}
        />
        <GitPullRequestCreateDialog
          gitPullRequestCreateTarget={gitPullRequestCreateTarget}
          createPullRequest={createPullRequest}
          closeGitPullRequestCreateModal={closeGitPullRequestCreateModal}
        />
        <CommitChangesDialog
          commitChangesTarget={commitChangesTarget}
          commitChanges={commitChanges}
          closeCommitChangesModal={closeCommitChangesModal}
        />
        <RowDiffDialog
          rowDiffTarget={rowDiffTarget}
          rowDiffLoadState={rowDiffLoadState}
          pathLauncher={pathLauncher}
          openCodePath={openCodePath}
          closeRowDiffModal={closeRowDiffModal}
        />
        <TerminalDialog
          terminalTarget={terminalTarget}
          closeTerminalModal={closeTerminalModal}
          updateTerminalStatusState={updateTerminalStatusState}
          showErrorMessage={showErrorMessage}
        />
        <ConfirmationDialog
          isOpen={gitRefDeleteTarget !== null}
          closeConfirmationDialog={closeGitRefDeleteModal}
          title={
            gitRefDeleteTarget === null
              ? ""
              : gitRefDeleteTarget.gitRefType === "branch"
                ? "Delete Branch"
                : "Delete Tag"
          }
          description={
            gitRefDeleteTarget === null ? (
              ""
            ) : (
              <span className="dialog-description-inline">
                Are you sure you want to delete{" "}
                <GitRefModalBadge
                  gitRefType={gitRefDeleteTarget.gitRefType}
                  name={gitRefDeleteTarget.name}
                />
                ?
              </span>
            )
          }
          confirmButtonText="Delete"
          confirmButtonVariant="default"
          isConfirmDisabled={gitRefDeleteTarget?.shouldBlockDelete === true}
          confirmButtonAction={deleteSelectedGitRef}
        >
          {gitRefDeleteTarget === null ||
          gitRefDeleteTarget.warningMessage === null ? undefined : (
            <Alert className="git-action-warning" variant="destructive">
              <AlertDescription>
                {gitRefDeleteTarget.warningMessage}
              </AlertDescription>
            </Alert>
          )}
        </ConfirmationDialog>
        <ConfirmationDialog
          isOpen={branchMergeConfirmation !== null}
          closeConfirmationDialog={closeBranchMergeConfirmationModal}
          title="Merge Branch"
          description={
            branchMergeConfirmation === null ? (
              ""
            ) : (
              <span className="dialog-description-inline">
                Merge{" "}
                <GitRefModalBadge
                  gitRefType="branch"
                  name={branchMergeConfirmation.branch}
                />{" "}
                into{" "}
                <GitRefModalBadge
                  gitRefType="branch"
                  name={branchMergeConfirmation.targetBranch}
                />
                ?
              </span>
            )
          }
          confirmButtonText="Merge"
          confirmButtonVariant="default"
          isConfirmDisabled={false}
          confirmButtonAction={confirmBranchMerge}
        >
          {branchMergeConfirmation === null ? undefined : (
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
                  {branchMergeConfirmation.preview.conflictCount}{" "}
                  {branchMergeConfirmation.preview.conflictCount === 1
                    ? "conflict"
                    : "conflicts"}
                </strong>
                .
              </span>
            </div>
          )}
        </ConfirmationDialog>
        <ConfirmationDialog
          isOpen={branchPushConfirmation !== null}
          closeConfirmationDialog={closeBranchPushModal}
          title="Push"
          description={branchPushConfirmationDescription}
          confirmButtonText="Push"
          confirmButtonVariant="default"
          isConfirmDisabled={false}
          confirmButtonAction={confirmBranchPushChange}
        >
          {branchPushConfirmation === null ? undefined : (
            <>
              <ul className="branch-tag-change-list">
                {branchPushConfirmation.branchSyncChanges.map(
                  (branchSyncChange) => (
                    <li
                      key={`${branchSyncChange.repoRoot}:${branchSyncChange.gitRefType}:${branchSyncChange.name}`}
                    >
                      <GitRefModalBadge
                        gitRefType={branchSyncChange.gitRefType}
                        name={branchSyncChange.name}
                      />
                      <code>
                        {readBranchSyncChangeSummary({
                          branchSyncChange,
                          summaryMode: "rowPush",
                        })}
                      </code>
                    </li>
                  ),
                )}
              </ul>
              {branchPushWarningMessages.length === 0 ? null : (
                <Alert className="git-action-warning" variant="destructive">
                  <AlertTitle>Warnings:</AlertTitle>
                  {branchPushWarningMessages.map((warningMessage) => (
                    <AlertDescription key={warningMessage}>
                      {warningMessage}
                    </AlertDescription>
                  ))}
                </Alert>
              )}
            </>
          )}
        </ConfirmationDialog>
        <ConfirmationDialog
          isOpen={headMoveConfirmation !== null}
          closeConfirmationDialog={closeHeadMoveConfirmationModal}
          title="Move HEAD"
          description={
            headMoveConfirmation === null
              ? ""
              : `Are you sure you want to checkout to ${headMoveConfirmation.targetText}?`
          }
          confirmButtonText="Move HEAD"
          confirmButtonVariant="default"
          isConfirmDisabled={false}
          confirmButtonAction={moveHeadToConfirmationTarget}
          children={undefined}
        />
        <ConfirmationDialog
          isOpen={branchPointerMove !== null}
          closeConfirmationDialog={closeBranchPointerMoveModal}
          title={branchPointerOperationText?.title ?? ""}
          description={branchPointerOperationText?.message ?? ""}
          confirmButtonText={branchPointerOperationText?.buttonText ?? ""}
          confirmButtonVariant="default"
          isConfirmDisabled={branchPointerOperationText?.shouldBlock === true}
          confirmButtonAction={moveBranchPointer}
        >
          {branchPointerMove === null ? undefined : (
            <>
              <ul className="branch-tag-change-list">
                <li className="branch-pointer-change-row">
                  <strong>From</strong>
                  <span className="branch-pointer-change-commit">
                    <code>{branchPointerMove.oldShortSha}</code>
                    <span className="branch-pointer-change-subject">
                      {branchPointerMove.oldSubject}
                    </span>
                  </span>
                </li>
                <li className="branch-pointer-change-row">
                  <strong>To</strong>
                  <span className="branch-pointer-change-commit">
                    <code>{branchPointerMove.newShortSha}</code>
                    <span className="branch-pointer-change-subject">
                      {branchPointerMove.newSubject}
                    </span>
                  </span>
                </li>
              </ul>
              {branchPointerOperationText?.description ===
              null ? null : branchPointerOperationText?.shouldBlock ? (
                <Alert className="git-action-warning" variant="destructive">
                  <AlertDescription>
                    {branchPointerOperationText?.description}
                  </AlertDescription>
                </Alert>
              ) : (
                <DialogDescription>
                  {branchPointerOperationText?.description}
                </DialogDescription>
              )}
              {branchPointerMove.warningMessage === null ? null : (
                <Alert className="git-action-warning" variant="destructive">
                  <AlertDescription>
                    {branchPointerMove.warningMessage}
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </ConfirmationDialog>
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
}) => {
  return (
    <section className="repo-section">
      <div className="repo-header">{repoHeaderControls}</div>

      <div className="repo-panel">
        <CommitHistory
          commits={repo.commits}
          branchSyncChanges={repo.branchSyncChanges}
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
        />
      </div>
    </section>
  );
};

const ElectronApiMissingScreen = () => (
  <main className="electron-api-missing-screen">
    <Card className="electron-api-missing-card">
      <h1>Crabtree desktop UI</h1>
      <p>Open this app from Electron.</p>
    </Card>
  </main>
);

const CrabtreeDesktopApp = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [dashboardPaintWaitCount, setDashboardPaintWaitCount] = useState(0);
  const [selectedRepoRoot, setSelectedRepoRootState] = useState<string | null>(
    null,
  );
  const [pathLauncher, setPathLauncher] = useState<PathLauncher>("vscode");
  const [isLoading, setIsLoading] = useState(true);
  const [loadingRepoRoot, setLoadingRepoRootState] = useState<string | null>(
    null,
  );
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<
    string | null
  >(null);
  const [branchSyncConfirmation, setBranchSyncConfirmation] =
    useState<BranchSyncConfirmation | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isPrivateMode, setIsPrivateMode] = useState(
    readIsAnalyticsPrivateMode,
  );
  const [chatProviderDetections, setChatProviderDetections] = useState<
    ChatProviderDetection[]
  >(DEFAULT_CHAT_PROVIDER_DETECTIONS);
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>({
    type: "unavailable",
  });
  const userGitUpdateCountRef = useRef(0);
  const nextUserGitUpdateToastIdRef = useRef(0);
  const isDashboardRefreshRunningRef = useRef(false);
  const shouldRefreshDashboardAgainRef = useRef(false);
  const selectedRepoRootRef = useRef<string | null>(null);
  const loadingRepoRootRef = useRef<string | null>(null);
  const pendingDashboardRefreshRepoRootRef = useRef<string | null>(null);
  const dashboardRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const dashboardPaintResolversRef = useRef<(() => void)[]>([]);
  const dashboardWarningToastIdOfWarningRef = useRef<{
    [warning: string]: string | number;
  }>({});
  const isCurrentDashboardWarningOfWarningRef = useRef<{
    [warning: string]: boolean;
  }>({});
  const isDismissedDashboardWarningOfWarningRef = useRef<{
    [warning: string]: boolean;
  }>({});
  const codexThreadStatusOfIdRef = useRef<{
    [threadId: string]: CodexThreadStatusChange["status"];
  }>({});
  useEffect(() => {
    trackDesktopAppOpened();
  }, []);

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
  const dashboardWarnings =
    dashboardData === null ? [] : dashboardData.warnings;
  const dashboardWarningsKey = dashboardWarnings.join("\n");
  const isDashboardLoaded = dashboardData !== null;

  const applyDashboardData = useCallback((nextDashboardData: DashboardData) => {
    let nextSelectedRepoRoot = selectedRepoRootRef.current;

    if (
      nextSelectedRepoRoot === null ||
      !nextDashboardData.repos.some(
        (repo) => repo.root === nextSelectedRepoRoot,
      )
    ) {
      nextSelectedRepoRoot = nextDashboardData.repos[0]?.root ?? null;
      selectedRepoRootRef.current = nextSelectedRepoRoot;
      setSelectedRepoRootState(nextSelectedRepoRoot);
    }

    for (const thread of nextDashboardData.threads) {
      if (thread.status.type !== "notLoaded") {
        codexThreadStatusOfIdRef.current[thread.id] = thread.status;
      }
    }

    setDashboardData((currentDashboardData) => {
      if (currentDashboardData === null) {
        return {
          ...nextDashboardData,
          threads: nextDashboardData.threads.map((thread) => {
            const notificationStatus =
              codexThreadStatusOfIdRef.current[thread.id];

            if (
              notificationStatus === undefined ||
              thread.status.type !== "notLoaded"
            ) {
              return thread;
            }

            return { ...thread, status: notificationStatus };
          }),
        };
      }

      const threadOfId: { [threadId: string]: CodexThread } = {};

      for (const thread of currentDashboardData.threads) {
        threadOfId[thread.id] = thread;
      }

      return {
        ...nextDashboardData,
        threads: nextDashboardData.threads.map((thread) => {
          const currentThread = threadOfId[thread.id];
          const notificationStatus =
            codexThreadStatusOfIdRef.current[thread.id];
          const status =
            thread.status.type !== "notLoaded"
              ? thread.status
              : (notificationStatus ??
                (currentThread !== undefined
                  ? currentThread.status
                  : thread.status));

          return { ...thread, status };
        }),
      };
    });

    // Git read errors can come from old Codex threads, deleted folders, or blocked folders, so they should not block readable repos.
    setDashboardErrorMessage(null);
  }, []);
  const selectRepoRoot = useCallback((repoRoot: string | null) => {
    selectedRepoRootRef.current = repoRoot;
    setSelectedRepoRootState(repoRoot);
  }, []);
  const setLoadingRepoRoot = useCallback((repoRoot: string | null) => {
    if (repoRoot !== null) {
      const initialLoadingImageUrls = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
          "[data-initial-loading-image]",
        ),
        (initialLoadingImageLink) => initialLoadingImageLink.href,
      );

      if (initialLoadingImageUrls.length > 0) {
        const initialLoadingImageIndex = Math.floor(
          Math.random() * initialLoadingImageUrls.length,
        );
        const initialLoadingImageUrl =
          initialLoadingImageUrls[initialLoadingImageIndex];

        if (initialLoadingImageUrl !== undefined) {
          document.documentElement.style.setProperty(
            "--initial-loading-image-url",
            `url("${initialLoadingImageUrl}")`,
          );
        }
      }
    }

    loadingRepoRootRef.current = repoRoot;
    setLoadingRepoRootState(repoRoot);
  }, []);
  useEffect(() => {
    if (dashboardData === null && dashboardErrorMessage === null) {
      return;
    }

    document.getElementById("initial-loading-root")?.remove();
  }, [dashboardData, dashboardErrorMessage]);
  useEffect(() => {
    const dashboardPaintResolvers = dashboardPaintResolversRef.current;

    if (dashboardPaintResolvers.length === 0) {
      return;
    }

    dashboardPaintResolversRef.current = [];
    window.requestAnimationFrame(() => {
      for (const dashboardPaintResolver of dashboardPaintResolvers) {
        dashboardPaintResolver();
      }
    });
  }, [dashboardPaintWaitCount]);
  const refreshDashboardForRepoRoot = useCallback(
    async (repoRoot: string | null) => {
      if (isDashboardRefreshRunningRef.current) {
        shouldRefreshDashboardAgainRef.current = true;
        pendingDashboardRefreshRepoRootRef.current = repoRoot;

        if (dashboardRefreshPromiseRef.current !== null) {
          await dashboardRefreshPromiseRef.current;
        }

        return;
      }

      const dashboardRefreshPromise = (async () => {
        isDashboardRefreshRunningRef.current = true;
        setIsLoading(true);

        try {
          let nextRepoRoot = repoRoot;

          do {
            shouldRefreshDashboardAgainRef.current = false;
            pendingDashboardRefreshRepoRootRef.current = null;

            try {
              const nextDashboardData = await window.crabtree.readDashboard({
                repoRoot: nextRepoRoot,
              });

              if (userGitUpdateCountRef.current === 0) {
                applyDashboardData(nextDashboardData);

                if (
                  nextRepoRoot !== null &&
                  loadingRepoRootRef.current === nextRepoRoot
                ) {
                  setLoadingRepoRoot(null);
                }
              }
            } catch (error) {
              if (userGitUpdateCountRef.current > 0) {
                continue;
              }

              const message = readCaughtUserFacingErrorMessage({
                error,
                fallbackMessage: "Failed to load repositories.",
              });
              setDashboardErrorMessage(message);

              if (
                nextRepoRoot !== null &&
                loadingRepoRootRef.current === nextRepoRoot
              ) {
                setLoadingRepoRoot(null);
              }
            }
            nextRepoRoot = pendingDashboardRefreshRepoRootRef.current;
          } while (shouldRefreshDashboardAgainRef.current);
        } finally {
          isDashboardRefreshRunningRef.current = false;
          dashboardRefreshPromiseRef.current = null;
          setIsLoading(false);
        }
      })();

      dashboardRefreshPromiseRef.current = dashboardRefreshPromise;
      await dashboardRefreshPromise;
    },
    [applyDashboardData, setLoadingRepoRoot],
  );
  const refreshDashboard = useCallback(async () => {
    await refreshDashboardForRepoRoot(selectedRepoRootRef.current);
  }, [refreshDashboardForRepoRoot]);
  const refreshDashboardIfIdle = useCallback(async () => {
    if (
      userGitUpdateCountRef.current > 0 ||
      isDashboardRefreshRunningRef.current
    ) {
      return;
    }

    const repoRoot = selectedRepoRootRef.current;
    let nextDashboardData: DashboardData | null;

    try {
      nextDashboardData = await window.crabtree.readDashboardIfIdle({
        repoRoot,
      });
    } catch (error) {
      const message = readCaughtUserFacingErrorMessage({
        error,
        fallbackMessage: "Failed to refresh repositories.",
      });
      setDashboardErrorMessage(message);
      return;
    }

    if (
      nextDashboardData === null ||
      userGitUpdateCountRef.current > 0 ||
      isDashboardRefreshRunningRef.current ||
      repoRoot !== selectedRepoRootRef.current
    ) {
      return;
    }

    startTransition(() => {
      applyDashboardData(nextDashboardData);
    });
  }, [applyDashboardData]);
  const refreshDashboardAfterUserGitUpdate = useCallback(
    async (finishUserGitUpdate: () => void) => {
      setIsLoading(true);

      try {
        const nextDashboardData =
          await window.crabtree.readDashboardAfterGitMutation();
        applyDashboardData(nextDashboardData);
        await new Promise<void>((resolve) => {
          dashboardPaintResolversRef.current.push(resolve);
          setDashboardPaintWaitCount(
            (currentDashboardPaintWaitCount) =>
              currentDashboardPaintWaitCount + 1,
          );
        });
        finishUserGitUpdate();
        return true;
      } catch (error) {
        finishUserGitUpdate();
        const message = readCaughtUserFacingErrorMessage({
          error,
          fallbackMessage: "Failed to refresh repositories.",
        });
        setDashboardErrorMessage(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [applyDashboardData],
  );
  useEffect(() => {
    let didCancel = false;
    const stopWatchingAppUpdateStatus =
      window.crabtree.watchAppUpdateStatus(setAppUpdateStatus);

    void window.crabtree
      .readAppUpdateStatus()
      .then((nextAppUpdateStatus) => {
        if (!didCancel) {
          setAppUpdateStatus(nextAppUpdateStatus);
        }
      })
      .catch((error) => {
        console.error("Failed to read app update status.", error);
      });

    return () => {
      didCancel = true;
      stopWatchingAppUpdateStatus();
    };
  }, []);
  useEffect(() => {
    let didCancel = false;

    void window.crabtree
      .readChatProviderDetections()
      .then((nextChatProviderDetections) => {
        if (!didCancel) {
          setChatProviderDetections(nextChatProviderDetections);
        }
      })
      .catch((error) => {
        console.error("Failed to read chat provider detections.", error);
      });

    return () => {
      didCancel = true;
    };
  }, []);
  useEffect(() => {
    const stopWatchingCodexThreadStatus =
      window.crabtree.watchCodexThreadStatus(
        (codexThreadStatusChange: CodexThreadStatusChange) => {
          codexThreadStatusOfIdRef.current[codexThreadStatusChange.threadId] =
            codexThreadStatusChange.status;

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
              return { ...thread, status: codexThreadStatusChange.status };
            });

            if (!didUpdateThread) {
              return currentDashboardData;
            }

            return { ...currentDashboardData, threads };
          });
        },
      );

    return () => {
      stopWatchingCodexThreadStatus();
    };
  }, []);
  const showSuccessMessage = useCallback((message: string) => {
    toast.success(message, {
      closeButton: false,
      position: TOAST_POSITION,
    });
  }, []);
  const showErrorMessage = useCallback((message: string) => {
    const userFacingMessage = readUserFacingErrorMessage(message);

    if (userFacingMessage !== message) {
      console.error(message);
    }

    showErrorToast({ title: "Error", description: userFacingMessage });
  }, []);
  // User Git updates use this wrapper so the loading toast is tied to action results, not background polling.
  const runUserGitUpdate = useCallback(
    async (
      userGitUpdateDescription: string,
      updateGit: (finishUserGitUpdate: () => void) => Promise<void>,
    ) => {
      let didFinishUserGitUpdate = false;
      const toastId = `${USER_GIT_UPDATE_TOAST_ID_PREFIX}:${nextUserGitUpdateToastIdRef.current}`;
      nextUserGitUpdateToastIdRef.current += 1;
      const finishUserGitUpdate = () => {
        if (didFinishUserGitUpdate) {
          return;
        }

        didFinishUserGitUpdate = true;
        const nextUserGitUpdateCount = Math.max(
          0,
          userGitUpdateCountRef.current - 1,
        );
        userGitUpdateCountRef.current = nextUserGitUpdateCount;
        toast.dismiss(toastId);
      };

      userGitUpdateCountRef.current += 1;
      toast.loading("Updating", {
        closeButton: false,
        description: `${userGitUpdateDescription}...`,
        dismissible: false,
        duration: Infinity,
        id: toastId,
        position: TOAST_POSITION,
      });

      try {
        await updateGit(finishUserGitUpdate);
      } finally {
        finishUserGitUpdate();
      }
    },
    [],
  );
  useEffect(() => {
    let dashboardRefreshTimeoutId: number | null = null;
    let didCancel = false;
    const refreshDashboardWhenIdle = async () => {
      await refreshDashboardIfIdle();

      if (!didCancel) {
        dashboardRefreshTimeoutId = window.setTimeout(() => {
          void refreshDashboardWhenIdle();
        }, DASHBOARD_REFRESH_INTERVAL_MS);
      }
    };

    void refreshDashboard();
    dashboardRefreshTimeoutId = window.setTimeout(() => {
      void refreshDashboardWhenIdle();
    }, DASHBOARD_REFRESH_INTERVAL_MS);

    return () => {
      didCancel = true;

      if (dashboardRefreshTimeoutId !== null) {
        window.clearTimeout(dashboardRefreshTimeoutId);
      }
    };
  }, [refreshDashboard, refreshDashboardIfIdle]);

  useEffect(() => {
    if (dashboardErrorMessage === null) {
      return;
    }

    const title = isDashboardLoaded
      ? "Failed to refresh repositories"
      : "Failed to load repositories";

    showErrorToast({
      title,
      description: dashboardErrorMessage,
    });
  }, [dashboardErrorMessage, isDashboardLoaded]);
  useEffect(() => {
    const dashboardWarningToastIdOfWarning =
      dashboardWarningToastIdOfWarningRef.current;
    const isDismissedDashboardWarningOfWarning =
      isDismissedDashboardWarningOfWarningRef.current;
    const isCurrentDashboardWarningOfWarning: { [warning: string]: boolean } =
      {};

    for (const warning of dashboardWarnings) {
      isCurrentDashboardWarningOfWarning[warning] = true;
    }

    isCurrentDashboardWarningOfWarningRef.current =
      isCurrentDashboardWarningOfWarning;

    for (const warning of Object.keys(dashboardWarningToastIdOfWarning)) {
      if (isCurrentDashboardWarningOfWarning[warning] === true) {
        continue;
      }

      toast.dismiss(dashboardWarningToastIdOfWarning[warning]);
      delete dashboardWarningToastIdOfWarning[warning];
    }

    for (const warning of Object.keys(isDismissedDashboardWarningOfWarning)) {
      if (isCurrentDashboardWarningOfWarning[warning] === true) {
        continue;
      }

      delete isDismissedDashboardWarningOfWarning[warning];
    }

    for (const warning of dashboardWarnings) {
      if (
        dashboardWarningToastIdOfWarning[warning] !== undefined ||
        isDismissedDashboardWarningOfWarning[warning] === true
      ) {
        continue;
      }

      const toastId = `${DASHBOARD_WARNING_TOAST_ID_PREFIX}:${warning}`;
      dashboardWarningToastIdOfWarning[warning] = toast.warning(
        "Dashboard warning",
        {
          closeButton: true,
          description: warning,
          duration: Infinity,
          id: toastId,
          onDismiss: () => {
            delete dashboardWarningToastIdOfWarning[warning];

            if (
              isCurrentDashboardWarningOfWarningRef.current[warning] !== true
            ) {
              return;
            }

            isDismissedDashboardWarningOfWarning[warning] = true;
          },
          onAutoClose: () => {
            delete dashboardWarningToastIdOfWarning[warning];
          },
          position: TOAST_POSITION,
        },
      );
    }
  }, [dashboardWarningsKey]);

  const readVisibleBranchSyncChangesForRepo = (repoRoot: string) => {
    const repo =
      dashboardData === null
        ? undefined
        : dashboardData.repos.find(
            (dashboardRepo) => dashboardRepo.root === repoRoot,
          );

    return repo === undefined ? [] : repo.branchSyncChanges;
  };
  const openBranchSyncModal = (action: BranchSyncAction, repoRoot: string) => {
    const repoBranchSyncChanges = readActionableBranchSyncChanges({
      action,
      branchSyncChanges: readVisibleBranchSyncChangesForRepo(repoRoot),
    });

    if (repoBranchSyncChanges.length === 0) {
      return;
    }

    setBranchSyncConfirmation({ action, repoRoot });
  };
  const closeBranchSyncModal = () => {
    setBranchSyncConfirmation(null);
  };
  const confirmBranchSyncChanges = async () => {
    if (branchSyncConfirmation === null) {
      return;
    }

    const { action, repoRoot } = branchSyncConfirmation;
    const branchSyncActionText = readBranchSyncActionText(action);
    const changes = readActionableBranchSyncChanges({
      action,
      branchSyncChanges: readVisibleBranchSyncChangesForRepo(repoRoot),
    });

    if (changes.length === 0) {
      closeBranchSyncModal();
      return;
    }

    closeBranchSyncModal();

    await runUserGitUpdate(
      branchSyncActionText.loadingDescription,
      async (finishUserGitUpdate) => {
        let gitSuccessMessage: string | null = null;
        let gitErrorMessage: string | null = null;

        try {
          switch (action) {
            case "push":
              await window.crabtree.pushGitBranchSyncChanges(changes);
              break;
            case "revert":
              await window.crabtree.revertGitBranchSyncChanges(changes);
              break;
          }

          trackDesktopAction({
            eventName:
              action === "push" ? "branches_pushed" : "branches_pulled",
            properties: { change_count: changes.length },
          });
          gitSuccessMessage = branchSyncActionText.successMessage;
        } catch (error) {
          gitErrorMessage =
            error instanceof Error
              ? error.message
              : "Failed to apply branch sync changes.";
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
  const branchSyncChangesInConfirmation =
    branchSyncConfirmation === null
      ? []
      : readActionableBranchSyncChanges({
          action: branchSyncConfirmation.action,
          branchSyncChanges: readVisibleBranchSyncChangesForRepo(
            branchSyncConfirmation.repoRoot,
          ),
        });
  const branchSyncConfirmationRepo =
    branchSyncConfirmation === null || dashboardData === null
      ? null
      : (dashboardData.repos.find(
          (repo) => repo.root === branchSyncConfirmation.repoRoot,
        ) ?? null);
  const branchSyncPushWarningMessages =
    branchSyncConfirmation?.action === "push" &&
    branchSyncConfirmationRepo !== null
      ? readBranchSyncPushWarningMessages({
          branchSyncChanges: branchSyncChangesInConfirmation,
          commits: branchSyncConfirmationRepo.commits,
        })
      : [];
  const branchSyncActionText =
    branchSyncConfirmation === null
      ? null
      : readBranchSyncActionText(branchSyncConfirmation.action);

  if (dashboardData === null) {
    if (dashboardErrorMessage !== null) {
      return (
        <>
          <main className="initial-loading-screen">
            <div className="initial-loading-content">
              <div className="initial-loading-error">
                <div className="initial-loading-error-title">
                  Failed to load repositories
                </div>
                <div className="initial-loading-error-message">
                  {dashboardErrorMessage}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshDashboard()}
                >
                  Retry
                </Button>
              </div>
            </div>
          </main>
          <Toaster />
        </>
      );
    }

    return <Toaster />;
  }
  const openSelectedRepoPath = async () => {
    if (selectedRepo === null) {
      return;
    }

    try {
      await window.crabtree.openPath({
        path: selectedRepo.root,
        launcher: pathLauncher,
      });
      trackDesktopAction({
        eventName: "repo_opened",
        properties: { launcher: pathLauncher, source: "header" },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open repo.";
      showErrorMessage(message);
    }
  };
  const changeSelectedRepoRoot = (repoRoot: string) => {
    selectRepoRoot(repoRoot);
    setLoadingRepoRoot(repoRoot);
    void refreshDashboardForRepoRoot(repoRoot);
    trackDesktopAction({ eventName: "repo_selected", properties: {} });
  };
  const changePathLauncher = (value: string) => {
    const nextPathLauncher = readPathLauncher(value);

    if (nextPathLauncher !== null) {
      setPathLauncher(nextPathLauncher);
      trackDesktopAction({
        eventName: "path_launcher_changed",
        properties: { launcher: nextPathLauncher },
      });
    }
  };
  const changePrivateMode = (checked: boolean | "indeterminate") => {
    const nextIsPrivateMode = checked === true;
    setAnalyticsPrivateMode(nextIsPrivateMode);
    setIsPrivateMode(nextIsPrivateMode);
  };
  const runAppUpdateAction = async () => {
    try {
      if (appUpdateStatus.type === "ready") {
        await window.crabtree.quitAndInstallAppUpdate();
        return;
      }

      const nextAppUpdateStatus = await window.crabtree.checkForAppUpdate();
      setAppUpdateStatus(nextAppUpdateStatus);

      switch (nextAppUpdateStatus.type) {
        case "idle":
          showSuccessMessage("Crabtree is up to date.");
          return;
        case "ready":
          showSuccessMessage("Update ready.");
          return;
        case "error":
          showErrorMessage(nextAppUpdateStatus.message);
          return;
        case "unavailable":
        case "checking":
        case "downloading":
          return;
      }
    } catch (error) {
      const message = readCaughtUserFacingErrorMessage({
        error,
        fallbackMessage: "Failed to update Crabtree.",
      });
      showErrorMessage(message);
    }
  };
  const selectedRepoBranchSyncChanges =
    selectedRepo === null
      ? []
      : readVisibleBranchSyncChangesForRepo(selectedRepo.root);
  const selectedRepoPushableBranchSyncChanges = readActionableBranchSyncChanges(
    {
      action: "push",
      branchSyncChanges: selectedRepoBranchSyncChanges,
    },
  );
  const selectedRepoRevertableBranchSyncChanges =
    readActionableBranchSyncChanges({
      action: "revert",
      branchSyncChanges: selectedRepoBranchSyncChanges,
    });
  const isSelectedRepoContextLoading =
    loadingRepoRoot !== null && selectedRepo?.root === loadingRepoRoot;
  const emptyRepoDescription =
    dashboardData.gitErrors.length > 0 && dashboardData.threads.length > 0
      ? "Crabtree found chats, but Git could not read their folders. " +
        "They may be deleted, moved, not valid Git worktrees, or blocked by macOS permissions."
      : "No Git repositories found from Codex or OpenCode.";
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
              <BottomTitleTooltip title="Sync with origin">
                <span className="repo-action-tooltip-trigger">
                  <button
                    className="repo-action-control"
                    type="button"
                    aria-label="Sync"
                    onClick={() =>
                      openBranchSyncModal("revert", selectedRepo.root)
                    }
                    disabled={
                      selectedRepoRevertableBranchSyncChanges.length === 0
                    }
                  >
                    <CircleArrowDown
                      aria-hidden="true"
                      size={18}
                      strokeWidth={1.75}
                    />
                    <span>Sync</span>
                  </button>
                </span>
              </BottomTitleTooltip>
              <BottomTitleTooltip title="Push to origin">
                <span className="repo-action-tooltip-trigger">
                  <button
                    className="repo-action-control"
                    type="button"
                    aria-label="Push"
                    onClick={() =>
                      openBranchSyncModal("push", selectedRepo.root)
                    }
                    disabled={
                      selectedRepoPushableBranchSyncChanges.length === 0
                    }
                  >
                    <CircleArrowUp
                      aria-hidden="true"
                      size={18}
                      strokeWidth={1.75}
                    />
                    <span>Push</span>
                  </button>
                </span>
              </BottomTitleTooltip>
            </>
          )}
          <button
            aria-label="Open Settings"
            className="repo-action-control"
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
          >
            <Settings aria-hidden="true" size={18} strokeWidth={1.75} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <main className="app-shell">
        <ConfirmationDialog
          isOpen={branchSyncConfirmation !== null}
          closeConfirmationDialog={closeBranchSyncModal}
          title={branchSyncActionText?.title ?? ""}
          description={branchSyncActionText?.message ?? ""}
          confirmButtonText={branchSyncActionText?.buttonText ?? ""}
          confirmButtonVariant="default"
          isConfirmDisabled={false}
          confirmButtonAction={confirmBranchSyncChanges}
        >
          {branchSyncConfirmation === null ? undefined : (
            <>
              <ul className="branch-tag-change-list">
                {branchSyncChangesInConfirmation.map((branchSyncChange) => (
                  <li
                    key={`${branchSyncChange.repoRoot}:${branchSyncChange.gitRefType}:${branchSyncChange.name}`}
                  >
                    <GitRefModalBadge
                      gitRefType={branchSyncChange.gitRefType}
                      name={branchSyncChange.name}
                    />
                    <code>
                      {readBranchSyncChangeSummary({
                        branchSyncChange,
                        summaryMode: "default",
                      })}
                    </code>
                  </li>
                ))}
              </ul>
              {branchSyncPushWarningMessages.length === 0 ? null : (
                <Alert className="git-action-warning" variant="destructive">
                  <AlertTitle>Warnings:</AlertTitle>
                  {branchSyncPushWarningMessages.map((warningMessage) => (
                    <AlertDescription key={warningMessage}>
                      {warningMessage}
                    </AlertDescription>
                  ))}
                </Alert>
              )}
            </>
          )}
        </ConfirmationDialog>
        <Dialog
          open={isSettingsModalOpen}
          onOpenChange={setIsSettingsModalOpen}
        >
          <DialogContent
            aria-describedby={undefined}
            className="settings-modal"
          >
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <dl className="settings-modal-fields">
              <div className="settings-modal-field">
                <dt>Version</dt>
                <dd>v{packageInfo.version}</dd>
              </div>
              <div className="settings-modal-field">
                <dt>Updates</dt>
                <dd>
                  <Button
                    className={
                      appUpdateStatus.type === "ready"
                        ? undefined
                        : "bg-white hover:bg-white aria-expanded:bg-white"
                    }
                    onClick={() => {
                      void runAppUpdateAction();
                    }}
                    size="sm"
                    type="button"
                    variant={
                      appUpdateStatus.type === "ready" ? "default" : "outline"
                    }
                  >
                    {readAppUpdateButtonText(appUpdateStatus)}
                  </Button>
                </dd>
              </div>
            </dl>
            <div className="settings-modal-fields">
              <div className="private-mode-setting">
                <Checkbox
                  id="private-mode"
                  checked={isPrivateMode}
                  onCheckedChange={changePrivateMode}
                />
                <div className="private-mode-setting-text">
                  <Label htmlFor="private-mode">Private mode</Label>
                  <p>
                    Disable completely anonymous metrics that help us improve
                    the app?
                  </p>
                </div>
              </div>
            </div>
            <section className="chat-provider-detection-section">
              <h3 className="chat-provider-detection-title">Chat sources</h3>
              <div className="chat-provider-detection-list">
                {chatProviderDetections.map((chatProviderDetection) => (
                  <div
                    className="chat-provider-detection-row"
                    key={chatProviderDetection.providerId}
                  >
                    <span className="chat-provider-detection-label">
                      {readChatProviderLabel(chatProviderDetection.providerId)}
                    </span>
                    <ChatProviderDetectionStatus
                      isDetected={chatProviderDetection.isDetected}
                    />
                  </div>
                ))}
              </div>
            </section>
            <dl className="settings-modal-fields">
              <div className="settings-modal-field">
                <dt>GitHub</dt>
                <dd>
                  <a
                    className="settings-modal-link"
                    href={GITHUB_REPOSITORY_URL}
                    onClick={(event) => {
                      event.preventDefault();
                      trackDesktopAction({
                        eventName: "github_clicked",
                        properties: { button_location: "settings" },
                      });
                      void window.crabtree.openExternalUrl(
                        GITHUB_REPOSITORY_URL,
                      );
                    }}
                    rel="noreferrer"
                    target="_blank"
                  >
                    glassdevtools/crabtree
                  </a>
                </dd>
              </div>
            </dl>
          </DialogContent>
        </Dialog>

        <div className="content-shell">
          <div className="repo-list">
            {isSelectedRepoContextLoading ? (
              <section className="repo-section">
                <div className="repo-header">{repoHeaderControls}</div>
                <div className="repo-panel">
                  <div className="repo-context-loading-screen">
                    <div className="initial-loading-content">
                      <div
                        className="initial-loading-image"
                        aria-hidden="true"
                      />
                      <div className="initial-loading-status">
                        <span
                          className="initial-loading-spinner"
                          aria-hidden="true"
                        />
                        <span>Loading repository...</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : selectedRepo === null ? null : (
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
              />
            )}
            {dashboardData.repos.length === 0 && !isLoading && (
              <Empty className="empty-state">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LuGitCommitHorizontal size={22} />
                  </EmptyMedia>
                  <EmptyDescription>{emptyRepoDescription}</EmptyDescription>
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

export const App = () => {
  if (window.crabtree === undefined) {
    return <ElectronApiMissingScreen />;
  }

  return <CrabtreeDesktopApp />;
};
