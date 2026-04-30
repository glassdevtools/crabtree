import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardRefreshCoordinator } from "../src/main/dashboardRefresh";
import type { DashboardData } from "../src/shared/types";

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

const createDeferredDashboardData = () => {
  let resolveDashboardData: (dashboardData: DashboardData) => void = () => {};
  const promise = new Promise<DashboardData>((resolve) => {
    resolveDashboardData = resolve;
  });

  return {
    promise,
    resolveDashboardData,
  };
};

test("rereads changed repos when a git mutation happens during a full dashboard read", async () => {
  const fullRead = createDeferredDashboardData();
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
    dashboardRefreshCoordinator.readDashboardDataWithoutOverlap("full");

  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");
  const mutationReadPromise =
    dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
      "afterGitMutation",
    );

  fullRead.resolveDashboardData(createDashboardData("full"));

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
      return createDashboardData("full");
    },
    readDashboardDataAfterGitMutation: async () => {
      postMutationReadCount += 1;

      return createDashboardData("after-git-mutation");
    },
  });

  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");

  const fullReadResult =
    await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap("full");
  const mutationReadResult =
    await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap(
      "afterGitMutation",
    );

  assert.equal(fullReadResult.generatedAt, "full");
  assert.equal(mutationReadResult.generatedAt, "full");
  assert.equal(postMutationReadCount, 0);
});

test("does not treat duplicate changed repo marks as new mutations", async () => {
  const repoRootGroups: string[][] = [];
  let fullReadCount = 0;
  const dashboardRefreshCoordinator = createDashboardRefreshCoordinator({
    readFullDashboardData: async () => {
      fullReadCount += 1;

      return createDashboardData(`full-${fullReadCount}`);
    },
    readDashboardDataAfterGitMutation: async ({ repoRoots }) => {
      repoRootGroups.push(repoRoots);

      return createDashboardData("after-git-mutation");
    },
  });

  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");
  dashboardRefreshCoordinator.markChangedRepoRoot("/repo");

  const fullReadResult =
    await dashboardRefreshCoordinator.readDashboardDataWithoutOverlap("full");

  assert.equal(fullReadResult.generatedAt, "full-1");
  assert.equal(fullReadCount, 1);
  assert.deepEqual(repoRootGroups, []);
});
