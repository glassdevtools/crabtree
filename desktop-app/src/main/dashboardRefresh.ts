import type { DashboardData } from "../shared/types";

type DashboardReadMode = "full" | "afterGitMutation";

export const createDashboardRefreshCoordinator = ({
  readFullDashboardData,
  readDashboardDataAfterGitMutation,
}: {
  readFullDashboardData: () => Promise<DashboardData>;
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

  const readDashboardDataForMode = async (readMode: DashboardReadMode) => {
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
    dashboardDataCache = await readFullDashboardData();

    if (gitMutationVersion === gitMutationVersionBeforeRead) {
      changedRepoRootOfRoot = {};
    } else {
      pendingDashboardReadMode = mergeDashboardReadModes({
        currentMode: pendingDashboardReadMode,
        nextMode: "afterGitMutation",
      });
    }

    return dashboardDataCache;
  };

  const readDashboardDataWithoutOverlap = async (
    readMode: DashboardReadMode,
  ) => {
    if (dashboardReadPromise !== null) {
      pendingDashboardReadMode = mergeDashboardReadModes({
        currentMode: pendingDashboardReadMode,
        nextMode: readMode,
      });

      return await dashboardReadPromise;
    }

    const currentDashboardReadPromise = (async () => {
      let nextReadMode = readMode;

      for (;;) {
        pendingDashboardReadMode = null;
        const dashboardData = await readDashboardDataForMode(nextReadMode);

        if (pendingDashboardReadMode === null) {
          return dashboardData;
        }

        nextReadMode = pendingDashboardReadMode;
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
