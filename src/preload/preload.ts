import { contextBridge, ipcRenderer } from "electron";
import type {
  DashboardData,
  GitBranchTagChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitDeleteBranchRequest,
  GitMergeBranchRequest,
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
    return await ipcRenderer.invoke(
      "git:commitAllChanges",
      gitCommitChangesRequest,
    );
  },
  createGitBranch: async (gitCreateBranchRequest: GitCreateBranchRequest) => {
    await ipcRenderer.invoke("git:createBranch", gitCreateBranchRequest);
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
  previewGitMerge: async (gitMergeBranchRequest: GitMergeBranchRequest) => {
    return await ipcRenderer.invoke("git:previewMerge", gitMergeBranchRequest);
  },
  mergeGitBranch: async (gitMergeBranchRequest: GitMergeBranchRequest) => {
    await ipcRenderer.invoke("git:mergeBranch", gitMergeBranchRequest);
  },
};

contextBridge.exposeInMainWorld("molttree", api);
