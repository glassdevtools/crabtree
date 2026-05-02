import type { DashboardData } from "../shared/types";
import type { CodexThread } from "../shared/types";
import type { AppServerClient } from "./appServerClient";
import { readCodexThreads } from "./codexThreads";
import {
  readGitChangesOfCwdForRepoRoots,
  readRepoGraphs,
  readRepoGraphsForRepoRoots,
} from "./gitData";

// The dashboard joins Codex thread metadata with Git graph data into one renderer-friendly object.
export const readDashboardData = async ({
  appServerClient,
  focusedRepoRoot,
}: {
  appServerClient: AppServerClient;
  focusedRepoRoot: string | null;
}) => {
  const threads = await readCodexThreads(appServerClient);
  const repoGraphResult = await readRepoGraphs({ threads, focusedRepoRoot });
  const gitChangeResult = await readGitChangesOfCwdForRepoRoots({
    threads,
    repos: repoGraphResult.repos,
    previousGitChangesOfCwd: {},
    repoRoots: repoGraphResult.readRepoRoots,
  });

  const dashboardData: DashboardData = {
    generatedAt: new Date().toISOString(),
    repos: repoGraphResult.repos,
    threads,
    gitChangesOfCwd: gitChangeResult.gitChangesOfCwd,
    gitErrors: [...repoGraphResult.gitErrors, ...gitChangeResult.gitErrors],
    warnings: repoGraphResult.warnings,
  };

  return { dashboardData, readRepoRoots: repoGraphResult.readRepoRoots };
};

const readMessageDoesNotStartWithRepoRoot = ({
  message,
  repoRoots,
}: {
  message: string;
  repoRoots: string[];
}) => {
  for (const repoRoot of repoRoots) {
    if (message.startsWith(`${repoRoot}:`)) {
      return false;
    }
  }

  return true;
};

const pushUniqueMessages = ({
  messages,
  nextMessages,
}: {
  messages: string[];
  nextMessages: string[];
}) => {
  const isMessageIncluded: { [message: string]: boolean } = {};

  for (const message of messages) {
    isMessageIncluded[message] = true;
  }

  for (const message of nextMessages) {
    if (isMessageIncluded[message] === true) {
      continue;
    }

    messages.push(message);
    isMessageIncluded[message] = true;
  }
};

// User-initiated Git actions usually only change one repo, so this refresh keeps stable dashboard data and rereads the touched repo.
export const readDashboardDataAfterGitMutation = async ({
  previousDashboardData,
  repoRoots,
}: {
  previousDashboardData: DashboardData;
  repoRoots: string[];
}) => {
  const repoGraphResult = await readRepoGraphsForRepoRoots({
    threads: previousDashboardData.threads,
    repos: previousDashboardData.repos,
    repoRoots,
  });
  const gitChangeResult = await readGitChangesOfCwdForRepoRoots({
    threads: previousDashboardData.threads,
    repos: repoGraphResult.repos,
    previousGitChangesOfCwd: previousDashboardData.gitChangesOfCwd,
    repoRoots,
  });
  const warnings = previousDashboardData.warnings.filter((warning) =>
    readMessageDoesNotStartWithRepoRoot({ message: warning, repoRoots }),
  );
  const gitErrors = previousDashboardData.gitErrors.filter((gitError) =>
    readMessageDoesNotStartWithRepoRoot({ message: gitError, repoRoots }),
  );

  pushUniqueMessages({
    messages: warnings,
    nextMessages: repoGraphResult.warnings,
  });
  pushUniqueMessages({
    messages: gitErrors,
    nextMessages: [...repoGraphResult.gitErrors, ...gitChangeResult.gitErrors],
  });

  const dashboardData: DashboardData = {
    generatedAt: new Date().toISOString(),
    repos: repoGraphResult.repos,
    threads: previousDashboardData.threads,
    gitChangesOfCwd: gitChangeResult.gitChangesOfCwd,
    gitErrors,
    warnings,
  };

  return dashboardData;
};
