import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readOrCreateAnalyticsInstallId } from "../src/main/analyticsStore";

const withUserDataPath = async (
  runTest: (userDataPath: string) => Promise<void>,
) => {
  const userDataPath = await mkdtemp(join(tmpdir(), "branchmaster-analytics-"));

  try {
    await runTest(userDataPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
};

test("readOrCreateAnalyticsInstallId creates and reuses a random install ID", async () => {
  await withUserDataPath(async (userDataPath) => {
    const analyticsInstallId = await readOrCreateAnalyticsInstallId({
      userDataPath,
    });
    const storedAnalyticsInstallId = (
      await readFile(join(userDataPath, "analytics-install-id"), "utf8")
    ).trim();
    const nextAnalyticsInstallId = await readOrCreateAnalyticsInstallId({
      userDataPath,
    });

    assert.match(
      analyticsInstallId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(storedAnalyticsInstallId, analyticsInstallId);
    assert.equal(nextAnalyticsInstallId, analyticsInstallId);
  });
});

test("readOrCreateAnalyticsInstallId rejects an invalid stored install ID", async () => {
  await withUserDataPath(async (userDataPath) => {
    await writeFile(join(userDataPath, "analytics-install-id"), "not-a-uuid\n");

    await assert.rejects(async () => {
      await readOrCreateAnalyticsInstallId({ userDataPath });
    }, /Stored analytics install ID is invalid/);
  });
});
