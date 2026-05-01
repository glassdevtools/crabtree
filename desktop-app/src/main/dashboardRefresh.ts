import type { DashboardData } from "../shared/types";

type DashboardReadMode = "full" | "afterGitMutation";
type DashboardFullReadResult = {
  dashboardData: DashboardData;
  readRepoRoots: string[];
};

export const createDashboardRefreshCoordinator = ({
  readFullDashboardData,
  readDashboardDataAfterGitMutation,
}: {
  readFullDashboardData: ({
    repoRoot,
  }: {
    repoRoot: string | null;
  }) => Promise<DashboardFullReadResult>;
  readDashboardDataAfterGitMutation: ({
    previousDashboardData,
    repoRoots,
  }: {
    previousDashboardData: DashboardData;
    repoRoots: string[];
  }) => Promise<DashboardData>;
}) => {
  let dashboardDataCache: DashboardData | null = null;
  let dashboardReadPromise: Promise<DashboardData> | null = null;
  let pendingDashboardReadMode: DashboardReadMode | null = null;
  let pendingFullDashboardRepoRoot: string | null = null;
  let changedRepoRootOfRoot: { [repoRoot: string]: boolean } = {};
  let gitMutationVersion = 0;

  const mergeDashboardReadModes = ({
    currentMode,
    nextMode,
  }: {
    currentMode: DashboardReadMode | null;
    nextMode: DashboardReadMode;
  }) => {
    if (currentMode === "full" || nextMode === "full") {
      return "full";
    }

    return "afterGitMutation";
  };

  const markChangedRepoRoot = (repoRoot: string) => {
    if (changedRepoRootOfRoot[repoRoot] === true) {
      return;
    }

    changedRepoRootOfRoot[repoRoot] = true;
    gitMutationVersion += 1;
  };

  const takeChangedRepoRoots = () => {
    const repoRoots = Object.keys(changedRepoRootOfRoot);
    changedRepoRootOfRoot = {};

    return repoRoots;
  };

  const restoreChangedRepoRoots = (repoRoots: string[]) => {
    for (const repoRoot of repoRoots) {
      changedRepoRootOfRoot[repoRoot] = true;
    }
  };

  const readDashboardDataForMode = async ({
    readMode,
    repoRoot,
  }: {
    readMode: DashboardReadMode;
    repoRoot: string | null;
  }) => {
    if (readMode === "afterGitMutation" && dashboardDataCache !== null) {
      const changedRepoRoots = takeChangedRepoRoots();

      if (changedRepoRoots.length === 0) {
        return dashboardDataCache;
      }

      try {
        dashboardDataCache = await readDashboardDataAfterGitMutation({
          previousDashboardData: dashboardDataCache,
          repoRoots: changedRepoRoots,
        });
      } catch (error) {
        restoreChangedRepoRoots(changedRepoRoots);
        throw error;
      }

      return dashboardDataCache;
    }

    const gitMutationVersionBeforeRead = gitMutationVersion;
    const fullReadResult = await readFullDashboardData({ repoRoot });
    dashboardDataCache = fullReadResult.dashboardData;

    if (gitMutationVersion === gitMutationVersionBeforeRead) {
      for (const readRepoRoot of fullReadResult.readRepoRoots) {
        delete changedRepoRootOfRoot[readRepoRoot];
      }
    }

    if (
      gitMutationVersion !== gitMutationVersionBeforeRead ||
      Object.keys(changedRepoRootOfRoot).length > 0
    ) {
      pendingDashboardReadMode = mergeDashboardReadModes({
        currentMode: pendingDashboardReadMode,
        nextMode: "afterGitMutation",
      });
    }

    return dashboardDataCache;
  };

  const readDashboardDataWithoutOverlap = async (
    readMode: DashboardReadMode,
    repoRoot: string | null,
  ) => {
    if (dashboardReadPromise !== null) {
      pendingDashboardReadMode = mergeDashboardReadModes({
        currentMode: pendingDashboardReadMode,
        nextMode: readMode,
      });

      if (readMode === "full") {
        pendingFullDashboardRepoRoot = repoRoot;
      }

      return await dashboardReadPromise;
    }

    const currentDashboardReadPromise = (async () => {
      let nextReadMode = readMode;
      let nextRepoRoot = repoRoot;

      for (;;) {
        pendingDashboardReadMode = null;
        pendingFullDashboardRepoRoot = null;
        const dashboardData = await readDashboardDataForMode({
          readMode: nextReadMode,
          repoRoot: nextRepoRoot,
        });

        if (pendingDashboardReadMode === null) {
          return dashboardData;
        }

        nextReadMode = pendingDashboardReadMode;
        nextRepoRoot = pendingFullDashboardRepoRoot;
      }
    })();

    dashboardReadPromise = currentDashboardReadPromise;

    try {
      return await currentDashboardReadPromise;
    } finally {
      if (dashboardReadPromise === currentDashboardReadPromise) {
        dashboardReadPromise = null;
      }
    }
  };

  return {
    markChangedRepoRoot,
    readDashboardDataWithoutOverlap,
  };
};
