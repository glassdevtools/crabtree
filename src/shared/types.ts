export type CodexGitInfo = {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
};

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
  gitInfo: CodexGitInfo | null;
};

export type GitWorktree = {
  path: string;
  head: string | null;
  branch: string | null;
  isDetached: boolean;
  threadIds: string[];
};

export type GitCommit = {
  sha: string;
  shortSha: string;
  parents: string[];
  refs: string[];
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
  worktrees: GitWorktree[];
  commits: GitCommit[];
  threadIds: string[];
};

export type DashboardData = {
  generatedAt: string;
  repos: RepoGraph[];
  threads: CodexThread[];
  warnings: string[];
};

export type MoltTreeApi = {
  readDashboard: () => Promise<DashboardData>;
  openCodexThread: (threadId: string) => Promise<void>;
  openNewCodexThread: () => Promise<void>;
  openVSCodePath: (path: string) => Promise<void>;
};
