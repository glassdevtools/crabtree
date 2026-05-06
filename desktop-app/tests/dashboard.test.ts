import assert from "node:assert/strict";
import test from "node:test";
import { readDashboardData } from "../src/main/dashboard";
import type { ChatProviderDashboardData } from "../src/main/chatProviders";

const createChatProviderDashboardData = ({
  providerId,
  warnings,
}: {
  providerId: ChatProviderDashboardData["providerId"];
  warnings: string[];
}) => {
  const chatProviderDashboardData: ChatProviderDashboardData = {
    providerId,
    isDetected: false,
    repoFolders: [],
    threads: [],
    warnings,
  };

  return chatProviderDashboardData;
};

test("reads an empty dashboard without requiring any chat provider", async () => {
  const readResult = await readDashboardData({
    chatProviderDashboardData: [
      createChatProviderDashboardData({
        providerId: "codex",
        warnings: ["Codex warning"],
      }),
      createChatProviderDashboardData({
        providerId: "openCode",
        warnings: ["OpenCode warning"],
      }),
    ],
    focusedRepoRoot: null,
  });

  assert.deepEqual(readResult.readRepoRoots, []);
  assert.deepEqual(readResult.dashboardData.repos, []);
  assert.deepEqual(readResult.dashboardData.threads, []);
  assert.deepEqual(readResult.dashboardData.gitErrors, []);
  assert.deepEqual(readResult.dashboardData.warnings, [
    "Codex warning",
    "OpenCode warning",
  ]);
});
