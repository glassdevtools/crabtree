import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  AppUpdateStatus,
  CodexThreadStatusChange,
  DashboardData,
  DashboardReadRequest,
  GitBranchSyncChange,
  GitCheckoutCommitRequest,
  GitCommitChangesRequest,
  GitCreateBranchRequest,
  GitDiffRequest,
  GitCreatePullRequestRequest,
  GitCreateRefRequest,
  GitDeleteBranchRequest,
  GitDeleteTagRequest,
  GitMergeBranchRequest,
  GitMoveBranchRequest,
  GitMoveTagRequest,
  GitSwitchBranchRequest,
  CrabtreeApi,
  OpenPathRequest,
  TerminalSessionEvent,
  TerminalSessionResizeRequest,
  TerminalSessionStartRequest,
  TerminalSessionWriteRequest,
} from "../shared/types";

const api: CrabtreeApi = {
  readDashboard: async (request: DashboardReadRequest) => {
    const dashboardData: DashboardData = await ipcRenderer.invoke(
      "dashboard:read",
      request,
    );

    return dashboardData;
  },
  readDashboardIfIdle: async (request: DashboardReadRequest) => {
    const dashboardData: DashboardData | null = await ipcRenderer.invoke(
      "dashboard:readIfIdle",
      request,
    );

    return dashboardData;
  },
  readDashboardAfterGitMutation: async () => {
    const dashboardData: DashboardData = await ipcRenderer.invoke(
      "dashboard:readAfterGitMutation",
    );

    return dashboardData;
  },
  readAnalyticsInstallId: async () => {
    return await ipcRenderer.invoke("analytics:readInstallId");
  },
  readDesktopRuntimeInfo: async () => {
    return await ipcRenderer.invoke("desktop:readRuntimeInfo");
  },
  readChatProviderDetections: async () => {
    return await ipcRenderer.invoke("chatProviders:readDetections");
  },
  readAppUpdateStatus: async () => {
    return await ipcRenderer.invoke("appUpdate:readStatus");
  },
  watchAppUpdateStatus: (onStatusChange) => {
    const listener = (
      _event: IpcRendererEvent,
      appUpdateStatus: AppUpdateStatus,
    ) => {
      onStatusChange(appUpdateStatus);
    };

    ipcRenderer.on("appUpdate:statusChanged", listener);

    return () => {
      ipcRenderer.removeListener("appUpdate:statusChanged", listener);
    };
  },
  watchCodexThreadStatus: (onStatusChange) => {
    const listener = (
      _event: IpcRendererEvent,
      codexThreadStatusChange: CodexThreadStatusChange,
    ) => {
      onStatusChange(codexThreadStatusChange);
    };

    ipcRenderer.on("codex:threadStatusChanged", listener);

    return () => {
      ipcRenderer.removeListener("codex:threadStatusChanged", listener);
    };
  },
  checkForAppUpdate: async () => {
    return await ipcRenderer.invoke("appUpdate:check");
  },
  quitAndInstallAppUpdate: async () => {
    await ipcRenderer.invoke("appUpdate:quitAndInstall");
  },
  openCodexThread: async (threadId: string) => {
    await ipcRenderer.invoke("codex:openThread", threadId);
  },
  openNewCodexThread: async () => {
    await ipcRenderer.invoke("codex:openNewThread");
  },
  openExternalUrl: async (url: string) => {
    await ipcRenderer.invoke("external:openUrl", url);
  },
  openPath: async (openPathRequest: OpenPathRequest) => {
    await ipcRenderer.invoke("path:open", openPathRequest);
  },
  readTerminalSessions: async () => {
    return await ipcRenderer.invoke("terminal:readSessions");
  },
  watchTerminalSession: (onTerminalSessionEvent) => {
    const listener = (
      _event: IpcRendererEvent,
      terminalSessionEvent: TerminalSessionEvent,
    ) => {
      onTerminalSessionEvent(terminalSessionEvent);
    };

    ipcRenderer.on("terminal:sessionEvent", listener);

    return () => {
      ipcRenderer.removeListener("terminal:sessionEvent", listener);
    };
  },
  startTerminalSession: async (
    terminalSessionStartRequest: TerminalSessionStartRequest,
  ) => {
    return await ipcRenderer.invoke(
      "terminal:startSession",
      terminalSessionStartRequest,
    );
  },
  writeTerminalSession: async (
    terminalSessionWriteRequest: TerminalSessionWriteRequest,
  ) => {
    await ipcRenderer.invoke(
      "terminal:writeSession",
      terminalSessionWriteRequest,
    );
  },
  resizeTerminalSession: async (
    terminalSessionResizeRequest: TerminalSessionResizeRequest,
  ) => {
    await ipcRenderer.invoke(
      "terminal:resizeSession",
      terminalSessionResizeRequest,
    );
  },
  stopTerminalSession: async (cwd: string) => {
    await ipcRenderer.invoke("terminal:stopSession", cwd);
  },
  copyText: async (text: string) => {
    await ipcRenderer.invoke("clipboard:writeText", text);
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
  createGitRef: async (gitCreateRefRequest: GitCreateRefRequest) => {
    await ipcRenderer.invoke("git:createRef", gitCreateRefRequest);
  },
  deleteGitBranch: async (gitDeleteBranchRequest: GitDeleteBranchRequest) => {
    await ipcRenderer.invoke("git:deleteBranch", gitDeleteBranchRequest);
  },
  deleteGitTag: async (gitDeleteTagRequest: GitDeleteTagRequest) => {
    await ipcRenderer.invoke("git:deleteTag", gitDeleteTagRequest);
  },
  moveGitBranch: async (gitMoveBranchRequest: GitMoveBranchRequest) => {
    await ipcRenderer.invoke("git:moveBranch", gitMoveBranchRequest);
  },
  moveGitTag: async (gitMoveTagRequest: GitMoveTagRequest) => {
    await ipcRenderer.invoke("git:moveTag", gitMoveTagRequest);
  },
  switchGitBranch: async (gitSwitchBranchRequest: GitSwitchBranchRequest) => {
    await ipcRenderer.invoke("git:switchBranch", gitSwitchBranchRequest);
  },
  checkoutGitCommit: async (
    gitCheckoutCommitRequest: GitCheckoutCommitRequest,
  ) => {
    await ipcRenderer.invoke("git:checkoutCommit", gitCheckoutCommitRequest);
  },
  pushGitBranchSyncChanges: async (
    gitBranchSyncChanges: GitBranchSyncChange[],
  ) => {
    await ipcRenderer.invoke("git:pushBranchSyncChanges", gitBranchSyncChanges);
  },
  revertGitBranchSyncChanges: async (
    gitBranchSyncChanges: GitBranchSyncChange[],
  ) => {
    await ipcRenderer.invoke(
      "git:revertBranchSyncChanges",
      gitBranchSyncChanges,
    );
  },
  previewGitMerge: async (gitMergeBranchRequest: GitMergeBranchRequest) => {
    return await ipcRenderer.invoke("git:previewMerge", gitMergeBranchRequest);
  },
  mergeGitBranch: async (gitMergeBranchRequest: GitMergeBranchRequest) => {
    return await ipcRenderer.invoke("git:mergeBranch", gitMergeBranchRequest);
  },
  readGitDiff: async (gitDiffRequest: GitDiffRequest) => {
    return await ipcRenderer.invoke("git:readDiff", gitDiffRequest);
  },
  createGitPullRequest: async (
    gitCreatePullRequestRequest: GitCreatePullRequestRequest,
  ) => {
    return await ipcRenderer.invoke(
      "git:createPullRequest",
      gitCreatePullRequestRequest,
    );
  },
};

contextBridge.exposeInMainWorld("crabtree", api);
