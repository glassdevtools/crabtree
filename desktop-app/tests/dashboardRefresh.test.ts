import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardRefreshCoordinator } from "../src/main/dashboardRefresh";
import type { DashboardData } from "../src/shared/types";

type DashboardFullReadResult = {
  dashboardData: DashboardData;
  readRepoRoots: string[];
};

const createDashboardData = (generatedAt: string): DashboardData => {
  return {
    generatedAt,
    repos: [],
    threads: [],
    gitChangesOfCwd: {},
    gitErrors: [],
    warnings: [],
  };
};

const createDashboardFullReadResult = ({
  generatedAt,
  readRepoRoots,
}: {
  generatedAt: string;
  readRepoRoots: string[];
}): DashboardFullReadResult => {
  return { dashboardData: createDashboardData(generatedAt), readRepoRoots };
};

const createDeferredDashboardFullReadResult = () => {
  let resolveDashboardFullReadResult: (
    dashboardFullReadResult: DashboardFullReadResult,
  ) => void = () => {};
  const promise = new Promise<DashboardFullReadResult>((resolve) => {
    resolveDashboardFullReadResult = resolve;
  });

  return {
    promise,
    resolveDashboardFullReadResult,
  };
};

test("rereads changed repos when a git mutation happens during a full dashboard read", async () => {
  const fullRead = createDeferredDashboardFullReadResult();
  const repoRootGroups: string[][] = [];
  let fullReadCount = 0;
  const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
    readFullDashboardData: async () => {
      fullReadCount += 1;

      return await fullRead.promise;
    },
    readDashboardDataAfterGitMutation: async ({ repoRoots }) => {
      repoRootGroups.push(repoRoots);

      return createDashboardData("after-git-mutation");
    },
  });
  const fullReadPromise =
    dashboardRefreshCoordinator.readDashboardDataWithoutOverlap("full", null);

  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");
  const mutationReadPromise =
    dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
      "afterGitMutation",
      null,
    );

  fullRead.resolveDashboardFullReadResult(
    createDashboardFullReadResult({
      generatedAt: "full",
      readRepoRoots: ["/repo"],
    }),
  );

  const [fullReadResult, mutationReadResult] = await Promise.all([
    fullReadPromise,
    mutationReadPromise,
  ]);

  assert.equal(fullReadCount, 1);
  assert.deepEqual(repoRootGroups, [["/repo"]]);
  assert.equal(fullReadResult.generatedAt, "after-git-mutation");
  assert.equal(mutationReadResult.generatedAt, "after-git-mutation");
});

test("uses a full dashboard read for earlier git mutations", async () => {
  let postMutationReadCount = 0;
  const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
    readFullDashboardData: async () => {
      return createDashboardFullReadResult({
        generatedAt: "full",
        readRepoRoots: ["/repo"],
      });
    },
    readDashboardDataAfterGitMutation: async () => {
      postMutationReadCount += 1;

      return createDashboardData("after-git-mutation");
    },
  });

  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");

  const fullReadResult =
    await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
      "full",
      null,
    );
  const mutationReadResult =
    await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
      "afterGitMutation",
      null,
    );

  assert.equal(fullReadResult.generatedAt, "full");
  assert.equal(mutationReadResult.generatedAt, "full");
  assert.equal(postMutationReadCount, 0);
});

test("keeps earlier git mutations for repos that a full read did not cover", async () => {
  const repoRootGroups: string[][] = [];
  const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
    readFullDashboardData: async () => {
      return createDashboardFullReadResult({
        generatedAt: "full",
        readRepoRoots: ["/repo-two"],
      });
    },
    readDashboardDataAfterGitMutation: async ({ repoRoots }) => {
      repoRootGroups.push(repoRoots);

      return createDashboardData("after-git-mutation");
    },
  });

  dashboardRefreshCoordinator.markChangedRepoRoot("/repo-one");

  const fullReadResult =
    await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
      "full",
      "/repo-two",
    );

  assert.equal(fullReadResult.generatedAt, "after-git-mutation");
  assert.deepEqual(repoRootGroups, [["/repo-one"]]);
});

test("uses the latest focused repo root after an overlapping full dashboard read", async () => {
  const fullRead = createDeferredDashboardFullReadResult();
  const focusedRepoRoots: (string | null)[] = [];
  const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
    readFullDashboardData: async ({ repoRoot }) => {
      focusedRepoRoots.push(repoRoot);

      if (focusedRepoRoots.length === 1) {
        return await fullRead.promise;
      }

      return createDashboardFullReadResult({
        generatedAt: "second-full",
        readRepoRoots: ["/two"],
      });
    },
    readDashboardDataAfterGitMutation: async () => {
      return createDashboardData("after-git-mutation");
    },
  });
  const firstReadPromise =
    dashboardRefreshCoordinator.readDashboardDataWithoutOverlap("full", "/one");
  const secondReadPromise =
    dashboardRefreshCoordinator.readDashboardDataWithoutOverlap("full", "/two");

  fullRead.resolveDashboardFullReadResult(
    createDashboardFullReadResult({
      generatedAt: "first-full",
      readRepoRoots: ["/one"],
    }),
  );

  const [firstReadResult, secondReadResult] = await Promise.all([
    firstReadPromise,
    secondReadPromise,
  ]);

  assert.deepEqual(focusedRepoRoots, ["/one", "/two"]);
  assert.equal(firstReadResult.generatedAt, "second-full");
  assert.equal(secondReadResult.generatedAt, "second-full");
});

test("drops idle dashboard reads while another dashboard read is running", async () => {
  const fullRead = createDeferredDashboardFullReadResult();
  let fullReadCount = 0;
  const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
    readFullDashboardData: async () => {
      fullReadCount += 1;

      return await fullRead.promise;
    },
    readDashboardDataAfterGitMutation: async () => {
      return createDashboardData("after-git-mutation");
    },
  });
  const fullReadPromise =
    dashboardRefreshCoordinator.readDashboardDataWithoutOverlap("full", "/one");

  const idleReadResult =
    await dashboardRefreshCoordinator.readDashboardDataIfIdle("full", "/two");

  fullRead.resolveDashboardFullReadResult(
    createDashboardFullReadResult({
      generatedAt: "full",
      readRepoRoots: ["/one"],
    }),
  );

  const fullReadResult = await fullReadPromise;

  assert.equal(idleReadResult, null);
  assert.equal(fullReadCount, 1);
  assert.equal(fullReadResult.generatedAt, "full");
});

test("does not treat duplicate changed repo marks as new mutations", async () => {
  const repoRootGroups: string[][] = [];
  let fullReadCount = 0;
  const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
    readFullDashboardData: async () => {
      fullReadCount += 1;

      return createDashboardFullReadResult({
        generatedAt: `full-${fullReadCount}`,
        readRepoRoots: ["/repo"],
      });
    },
    readDashboardDataAfterGitMutation: async ({ repoRoots }) => {
      repoRootGroups.push(repoRoots);

      return createDashboardData("after-git-mutation");
    },
  });

  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");
  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");

  const fullReadResult =
    await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
      "full",
      null,
    );

  assert.equal(fullReadResult.generatedAt, "full-1");
  assert.equal(fullReadCount, 1);
  assert.deepEqual(repoRootGroups, []);
});
