import { contextBridge, ipcRenderer } from "electron";
import type {
  DashboardData,
  GitBranchTagChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitDeleteBranchRequest,
  GitDeleteWorktreeRequest,
  GitMergeRequest,
  GitMoveBranchRequest,
  MoltTreeApi,
} from "../shared/types";

const api: MoltTreeApi = {
  readDashboard: async () => {
    const dashboardData: DashboardData =
      await ipcRenderer.invoke("dashboard:read");

    return dashboardData;
  },
  openCodexThread: async (threadId: string) => {
    await ipcRenderer.invoke("codex:openThread", threadId);
  },
  openNewCodexThread: async () => {
    await ipcRenderer.invoke("codex:openNewThread");
  },
  openVSCodePath: async (path: string) => {
    await ipcRenderer.invoke("vscode:openPath", path);
  },
  stageGitChanges: async (path: string) => {
    await ipcRenderer.invoke("git:stageChanges", path);
  },
  unstageGitChanges: async (path: string) => {
    await ipcRenderer.invoke("git:unstageChanges", path);
  },
  commitAllGitChanges: async (
    gitCommitChangesRequest: GitCommitChangesRequest,
  ) => {
    await ipcRenderer.invoke("git:commitAllChanges", gitCommitChangesRequest);
  },
  deleteGitWorktree: async (
    gitDeleteWorktreeRequest: GitDeleteWorktreeRequest,
  ) => {
    await ipcRenderer.invoke("git:deleteWorktree", gitDeleteWorktreeRequest);
  },
  deleteGitBranch: async (gitDeleteBranchRequest: GitDeleteBranchRequest) => {
    await ipcRenderer.invoke("git:deleteBranch", gitDeleteBranchRequest);
  },
  moveGitBranch: async (gitMoveBranchRequest: GitMoveBranchRequest) => {
    await ipcRenderer.invoke("git:moveBranch", gitMoveBranchRequest);
  },
  checkoutGitCommit: async (
    gitCheckoutCommitRequest: GitCheckoutCommitRequest,
  ) => {
    await ipcRenderer.invoke("git:checkoutCommit", gitCheckoutCommitRequest);
  },
  pushGitBranchTagChanges: async (
    gitBranchTagChanges: GitBranchTagChange[],
  ) => {
    await ipcRenderer.invoke("git:pushBranchTagChanges", gitBranchTagChanges);
  },
  resetGitBranchTagChanges: async (
    gitBranchTagChanges: GitBranchTagChange[],
  ) => {
    await ipcRenderer.invoke("git:resetBranchTagChanges", gitBranchTagChanges);
  },
  startGitMerge: async (gitMergeRequest: GitMergeRequest) => {
    await ipcRenderer.invoke("git:startMerge", gitMergeRequest);
  },
};

contextBridge.exposeInMainWorld("molttree", api);
