import type { DashboardData } from "../shared/types";
import type { CodexThread } from "../shared/types";
import type { AppServerClient } from "./appServerClient";
import { readCodexThreads } from "./codexThreads";
import { readGitChangesOfCwd, readRepoGraphs } from "./gitData";

// The dashboard joins Codex thread metadata with Git graph data into one renderer-friendly object.
export const readDashboardData = async ({
  appServerClient,
}: {
  appServerClient: AppServerClient;
}) => {
  const warnings: string[] = [];
  let threads: CodexThread[] = [];

  try {
    threads = await readCodexThreads(appServerClient);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown Codex app-server error.";
    warnings.push(message);
  }

  const repoGraphResult = await readRepoGraphs({ threads });
  const gitChangeResult = await readGitChangesOfCwd({
    threads,
    repos: repoGraphResult.repos,
  });

  const dashboardData: DashboardData = {
    generatedAt: new Date().toISOString(),
    repos: repoGraphResult.repos,
    threads,
    gitChangesOfCwd: gitChangeResult.gitChangesOfCwd,
    gitErrors: [...repoGraphResult.gitErrors, ...gitChangeResult.gitErrors],
    warnings: [...warnings, ...repoGraphResult.warnings],
  };

  return dashboardData;
};
