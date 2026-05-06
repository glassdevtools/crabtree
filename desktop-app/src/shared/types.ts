export type ChatProviderId = "codex" | "openCode";

export type ChatThreadGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};

export type ChatThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: string[] };

export type ChatThread = {
  id: string;
  providerId: ChatProviderId;
  name: string | null;
  preview: string;
  cwd: string;
  path: string | null;
  source: string;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  status: ChatThreadStatus;
  gitInfo: ChatThreadGitInfo | null;
};

export type ChatThreadStatusChange = {
  threadId: string;
  status: ChatThreadStatus;
};

export type ChatThreadOpenRequest = {
  providerId: ChatProviderId;
  threadId: string;
  cwd: string;
};

export type ChatProviderRepoFolder = {
  providerId: ChatProviderId;
  path: string;
};

export type GitWorktree = {
  path: string;
  head: string | null;
  branch: string | null;
  isDetached: boolean;
  threadIds: string[];
};

export type GitChangeCounts = {
  added: number;
  removed: number;
  changedFileCount: number;
};

export type GitChangeSummary = {
  staged: GitChangeCounts;
  unstaged: GitChangeCounts;
};

export type GitCommitChangesRequest = {
  path: string;
  message: string;
};

export type GitCreateBranchRequest = {
  path: string;
  branch: string;
  expectedHeadSha: string;
};

export type GitCreateRefRequest = {
  repoRoot: string;
  gitRefType: "branch" | "tag";
  name: string;
  sha: string;
};

export type GitDeleteBranchRequest = {
  repoRoot: string;
  branch: string;
  oldSha: string;
};

export type GitDeleteTagRequest = {
  repoRoot: string;
  tag: string;
  oldSha: string;
};

export type GitMoveBranchRequest = {
  repoRoot: string;
  branch: string;
  oldSha: string;
  newSha: string;
  targetPath: string | null;
};

export type GitMoveTagRequest = {
  repoRoot: string;
  tag: string;
  oldSha: string;
  newSha: string;
};

export type GitSwitchBranchRequest = {
  repoRoot: string;
  path: string;
  branch: string;
  oldSha: string;
  newSha: string;
};

export type GitCheckoutCommitRequest = {
  repoRoot: string;
  sha: string;
};

export type GitMergeBranchRequest = {
  repoRoot: string;
  branch: string;
};

export type GitDiffRowTarget =
  | { type: "commit"; repoRoot: string; sha: string }
  | { type: "path"; path: string };

export type GitDiffRequest = {
  mode: "changesMadeHere" | "diffAgainstHead";
  target: GitDiffRowTarget;
};

export type GitDiffFile = {
  path: string;
  section: string | null;
  diff: string;
};

export type GitDiff = {
  files: GitDiffFile[];
};

export type GitCreatePullRequestRequest = {
  repoRoot: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  title: string;
  description: string;
};

export type GitMergePreview = {
  added: number;
  removed: number;
  conflictCount: number;
};

export type GitBranchTagChange = {
  repoRoot: string;
  branch: string;
  oldSha: string;
  newSha: string | null;
};

export type GitBranchSyncChange = {
  repoRoot: string;
  gitRefType: "branch" | "tag";
  name: string;
  localSha: string | null;
  originSha: string | null;
};

export type GitMergeBranchResult = GitBranchTagChange;

export type PathLauncher = "vscode" | "cursor" | "finder";

export type OpenPathRequest = {
  path: string;
  launcher: PathLauncher;
};

export type TerminalSessionStartRequest = {
  cwd: string;
  cols: number;
  rows: number;
};

export type TerminalSessionWriteRequest = {
  cwd: string;
  data: string;
};

export type TerminalSessionResizeRequest = {
  cwd: string;
  cols: number;
  rows: number;
};

export type TerminalSessionSnapshot = {
  cwd: string;
  output: string;
  isRunning: boolean;
  isBusy: boolean;
  cursor: number;
};

export type TerminalSessionSummary = {
  cwd: string;
  isRunning: boolean;
  isBusy: boolean;
};

export type TerminalSessionEvent =
  | { type: "data"; cwd: string; data: string; cursor: number }
  | {
      type: "status";
      cwd: string;
      isRunning: boolean;
      isBusy: boolean;
      cursor: number;
    };

export type GitCommit = {
  sha: string;
  shortSha: string;
  parents: string[];
  refs: string[];
  localBranches: string[];
  author: string;
  date: string;
  subject: string;
  threadIds: string[];
};

export type RepoGraph = {
  key: string;
  root: string;
  mainWorktreePath: string;
  originUrl: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  branchSyncChanges: GitBranchSyncChange[];
  worktrees: GitWorktree[];
  commits: GitCommit[];
  threadIds: string[];
};

export type DashboardData = {
  generatedAt: string;
  repos: RepoGraph[];
  threads: ChatThread[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  gitErrors: string[];
  warnings: string[];
};

export type DashboardReadRequest = {
  repoRoot: string | null;
};

export type DesktopRuntimeInfo = {
  platform: string;
  isPackaged: boolean;
};

export type ChatProviderDetection = {
  providerId: ChatProviderId;
  isDetected: boolean;
};

export type AppUpdateStatus =
  | { type: "unavailable" }
  | { type: "idle" }
  | { type: "checking" }
  | { type: "downloading"; version: string }
  | { type: "ready"; version: string }
  | { type: "error"; message: string };

export type CrabtreeApi = {
  readDashboard: (request: DashboardReadRequest) => Promise<DashboardData>;
  readDashboardIfIdle: (
    request: DashboardReadRequest,
  ) => Promise<DashboardData | null>;
  readDashboardAfterGitMutation: () => Promise<DashboardData>;
  readAnalyticsInstallId: () => Promise<string>;
  readDesktopRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  readChatProviderDetections: () => Promise<ChatProviderDetection[]>;
  readAppUpdateStatus: () => Promise<AppUpdateStatus>;
  watchAppUpdateStatus: (
    onStatusChange: (appUpdateStatus: AppUpdateStatus) => void,
  ) => () => void;
  watchChatThreadStatus: (
    onStatusChange: (chatThreadStatusChange: ChatThreadStatusChange) => void,
  ) => () => void;
  checkForAppUpdate: () => Promise<AppUpdateStatus>;
  quitAndInstallAppUpdate: () => Promise<void>;
  openChatThread: (
    chatThreadOpenRequest: ChatThreadOpenRequest,
  ) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  openPath: (openPathRequest: OpenPathRequest) => Promise<void>;
  readTerminalSessions: () => Promise<TerminalSessionSummary[]>;
  watchTerminalSession: (
    onTerminalSessionEvent: (
      terminalSessionEvent: TerminalSessionEvent,
    ) => void,
  ) => () => void;
  startTerminalSession: (
    terminalSessionStartRequest: TerminalSessionStartRequest,
  ) => Promise<TerminalSessionSnapshot>;
  writeTerminalSession: (
    terminalSessionWriteRequest: TerminalSessionWriteRequest,
  ) => Promise<void>;
  resizeTerminalSession: (
    terminalSessionResizeRequest: TerminalSessionResizeRequest,
  ) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  stageGitChanges: (path: string) => Promise<void>;
  unstageGitChanges: (path: string) => Promise<void>;
  commitAllGitChanges: (
    gitCommitChangesRequest: GitCommitChangesRequest,
  ) => Promise<string>;
  createGitBranch: (
    gitCreateBranchRequest: GitCreateBranchRequest,
  ) => Promise<void>;
  createGitRef: (gitCreateRefRequest: GitCreateRefRequest) => Promise<void>;
  deleteGitBranch: (
    gitDeleteBranchRequest: GitDeleteBranchRequest,
  ) => Promise<void>;
  deleteGitTag: (gitDeleteTagRequest: GitDeleteTagRequest) => Promise<void>;
  moveGitBranch: (gitMoveBranchRequest: GitMoveBranchRequest) => Promise<void>;
  moveGitTag: (gitMoveTagRequest: GitMoveTagRequest) => Promise<void>;
  switchGitBranch: (
    gitSwitchBranchRequest: GitSwitchBranchRequest,
  ) => Promise<void>;
  checkoutGitCommit: (
    gitCheckoutCommitRequest: GitCheckoutCommitRequest,
  ) => Promise<void>;
  pushGitBranchSyncChanges: (
    gitBranchSyncChanges: GitBranchSyncChange[],
  ) => Promise<void>;
  revertGitBranchSyncChanges: (
    gitBranchSyncChanges: GitBranchSyncChange[],
  ) => Promise<void>;
  previewGitMerge: (
    gitMergeBranchRequest: GitMergeBranchRequest,
  ) => Promise<GitMergePreview>;
  mergeGitBranch: (
    gitMergeBranchRequest: GitMergeBranchRequest,
  ) => Promise<GitMergeBranchResult>;
  readGitDiff: (gitDiffRequest: GitDiffRequest) => Promise<GitDiff>;
  createGitPullRequest: (
    gitCreatePullRequestRequest: GitCreatePullRequestRequest,
  ) => Promise<string>;
};
