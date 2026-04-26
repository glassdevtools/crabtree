import type { DashboardData } from "../shared/types";
import type { CodexThread } from "../shared/types";
import { createAppServerClient } from "./appServerClient";
import { readCodexThreads } from "./codexThreads";
import { readRepoGraphs } from "./gitData";

// The dashboard joins Codex thread metadata with Git graph data into one renderer-friendly object.
export const readDashboardData = async () => {
  const warnings: string[] = [];
  let threads: CodexThread[] = [];
  const appServerClient = await createAppServerClient();

  try {
    try {
      threads = await readCodexThreads(appServerClient);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown Codex app-server error.";
      warnings.push(message);
    }

    const repoGraphResult = await readRepoGraphs({ appServerClient, threads });

    const dashboardData: DashboardData = {
      generatedAt: new Date().toISOString(),
      repos: repoGraphResult.repos,
      threads,
      warnings: [...warnings, ...repoGraphResult.warnings],
    };

    return dashboardData;
  } finally {
    appServerClient.close();
  }
};
