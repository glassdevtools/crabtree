import { contextBridge, ipcRenderer } from "electron";
import type { DashboardData, MoltTreeApi } from "../shared/types";

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
};

contextBridge.exposeInMainWorld("molttree", api);
