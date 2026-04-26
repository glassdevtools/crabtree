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

export type GitMergeRequest = {
  repoRoot: string;
  fromSha: string;
  toSha: string;
  targetBranch: string | null;
  targetWorktreePath: string | null;
};

export type GitCommitChangesRequest = {
  path: string;
  message: string;
};

export type GitDeleteWorktreeRequest = {
  repoRoot: string;
  path: string;
};

export type GitDeleteBranchRequest = {
  repoRoot: string;
  branch: string;
};

export type GitMoveBranchRequest = {
  repoRoot: string;
  branch: string;
  oldSha: string;
  newSha: string;
};

export type GitCheckoutCommitRequest = {
  repoRoot: string;
  sha: string;
};

export type GitBranchTagChange = {
  repoRoot: string;
  branch: string;
  oldSha: string;
  newSha: string | null;
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
  originUrl: string | null;
  currentBranch: string | null;
  branchTagChanges: GitBranchTagChange[];
  worktrees: GitWorktree[];
  commits: GitCommit[];
  threadIds: string[];
};

export type DashboardData = {
  generatedAt: string;
  repos: RepoGraph[];
  threads: CodexThread[];
  gitChangesOfCwd: { [cwd: string]: GitChangeSummary };
  warnings: string[];
};

export type MoltTreeApi = {
  readDashboard: () => Promise<DashboardData>;
  openCodexThread: (threadId: string) => Promise<void>;
  openNewCodexThread: () => Promise<void>;
  openVSCodePath: (path: string) => Promise<void>;
  stageGitChanges: (path: string) => Promise<void>;
  unstageGitChanges: (path: string) => Promise<void>;
  commitAllGitChanges: (
    gitCommitChangesRequest: GitCommitChangesRequest,
  ) => Promise<void>;
  deleteGitWorktree: (
    gitDeleteWorktreeRequest: GitDeleteWorktreeRequest,
  ) => Promise<void>;
  deleteGitBranch: (
    gitDeleteBranchRequest: GitDeleteBranchRequest,
  ) => Promise<void>;
  moveGitBranch: (gitMoveBranchRequest: GitMoveBranchRequest) => Promise<void>;
  checkoutGitCommit: (
    gitCheckoutCommitRequest: GitCheckoutCommitRequest,
  ) => Promise<void>;
  pushGitBranchTagChanges: (
    gitBranchTagChanges: GitBranchTagChange[],
  ) => Promise<void>;
  resetGitBranchTagChanges: (
    gitBranchTagChanges: GitBranchTagChange[],
  ) => Promise<void>;
  startGitMerge: (gitMergeRequest: GitMergeRequest) => Promise<void>;
};
