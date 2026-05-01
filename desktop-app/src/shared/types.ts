export type CodexGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};

export type CodexThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: string[] };

export type CodexThread = {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  path: string | null;
  source: string;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  status: CodexThreadStatus;
  gitInfo: CodexGitInfo | null;
};

export type CodexThreadStatusChange = {
  threadId: string;
  status: CodexThreadStatus;
};

export type GitWorktree = {
  path: string;
  head: string | null;
  branch: string | null;
  isDetached: boolean;
  threadIds: string[];
};

export type GitChangeLineCounts = {
  added: number;
  removed: number;
};

export type GitChangeSummary = {
  staged: GitChangeLineCounts;
  unstaged: GitChangeLineCounts;
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
  sourcePath: string | null;
  targetPath: string | null;
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
  threads: CodexThread[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  gitErrors: string[];
  warnings: string[];
};

export type AppUpdateStatus =
  | { type: "unavailable" }
  | { type: "idle" }
  | { type: "checking" }
  | { type: "downloading"; version: string }
  | { type: "ready"; version: string }
  | { type: "error"; message: string };

export type MoltTreeApi = {
  readDashboard: () => Promise<DashboardData>;
  readDashboardAfterGitMutation: () => Promise<DashboardData>;
  readAnalyticsInstallId: () => Promise<string>;
  readAppUpdateStatus: () => Promise<AppUpdateStatus>;
  watchAppUpdateStatus: (
    onStatusChange: (appUpdateStatus: AppUpdateStatus) => void,
  ) => () => void;
  checkForAppUpdate: () => Promise<AppUpdateStatus>;
  quitAndInstallAppUpdate: () => Promise<void>;
  watchCodexThreadStatus: (
    onStatusChange: (codexThreadStatusChange: CodexThreadStatusChange) => void,
  ) => () => void;
  openCodexThread: (threadId: string) => Promise<void>;
  openNewCodexThread: () => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  openPath: (openPathRequest: OpenPathRequest) => Promise<void>;
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
  createGitPullRequest: (
    gitCreatePullRequestRequest: GitCreatePullRequestRequest,
  ) => Promise<string>;
};
