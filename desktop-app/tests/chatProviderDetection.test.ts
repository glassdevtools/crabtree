import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  readOpenCodeDatabasePath,
  readOpenCodeDashboardDataForHome,
  readOpenCodeRepoFoldersForHome,
  readChatProviderDetectionsForHome,
  readOpenCodeProjectDataPath,
} from "../src/main/chatProviderDetection";

const readPathExists = (path: string) => {
  try {
    statSync(path);

    return true;
  } catch {
    return false;
  }
};

const readIsDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const pathInfoReader = { readPathExists, readIsDirectory };

const withHomePath = async (runTest: (homePath: string) => Promise<void>) => {
  const homePath = await mkdtemp(join(tmpdir(), "crabtree-chat-providers-"));

  try {
    await runTest(homePath);
  } finally {
    await rm(homePath, { recursive: true, force: true });
  }
};

test("detects OpenCode when its project data directory exists", async () => {
  await withHomePath(async (homePath) => {
    await mkdir(readOpenCodeProjectDataPath({ homePath }), {
      recursive: true,
    });

    assert.deepEqual(
      readChatProviderDetectionsForHome({
        homePath,
        pathInfoReader,
      }),
      [{ providerId: "openCode", isDetected: true }],
    );
  });
});

test("detects OpenCode when its database exists", async () => {
  await withHomePath(async (homePath) => {
    const databasePath = readOpenCodeDatabasePath({ homePath });

    await mkdir(dirname(databasePath), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);

    database.close();

    assert.deepEqual(
      readChatProviderDetectionsForHome({
        homePath,
        pathInfoReader,
      }),
      [{ providerId: "openCode", isDetected: true }],
    );
  });
});

test("does not detect OpenCode when its project data directory is missing", async () => {
  await withHomePath(async (homePath) => {
    assert.deepEqual(
      readChatProviderDetectionsForHome({
        homePath,
        pathInfoReader,
      }),
      [{ providerId: "openCode", isDetected: false }],
    );
  });
});

test("reads OpenCode repo folders from its database", async () => {
  await withHomePath(async (homePath) => {
    const databasePath = readOpenCodeDatabasePath({ homePath });

    await mkdir(dirname(databasePath), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);

    try {
      database.exec(`
        CREATE TABLE project (worktree TEXT NOT NULL);
        CREATE TABLE session (
          id TEXT NOT NULL,
          directory TEXT NOT NULL,
          title TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          time_archived INTEGER
        );
        INSERT INTO project (worktree) VALUES ('/tmp/project-one'), ('/tmp/project-one');
        INSERT INTO session (id, directory, title, time_created, time_updated, time_archived)
          VALUES ('ses_two', '/tmp/project-two', 'Second project', 1000, 2000, NULL),
            ('ses_empty', '', 'No directory', 1000, 2000, NULL);
      `);
    } finally {
      database.close();
    }

    assert.deepEqual(
      await readOpenCodeRepoFoldersForHome({
        homePath,
        pathInfoReader,
      }),
      { repoFolders: ["/tmp/project-one", "/tmp/project-two"], warnings: [] },
    );
  });
});

test("reads OpenCode sessions from its database", async () => {
  await withHomePath(async (homePath) => {
    const databasePath = readOpenCodeDatabasePath({ homePath });

    await mkdir(dirname(databasePath), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath);

    try {
      database.exec(`
        CREATE TABLE project (worktree TEXT NOT NULL);
        CREATE TABLE session (
          id TEXT NOT NULL,
          directory TEXT NOT NULL,
          title TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          time_archived INTEGER
        );
        INSERT INTO project (worktree) VALUES ('/tmp/project-one');
        INSERT INTO session (id, directory, title, time_created, time_updated, time_archived)
          VALUES ('ses_one', '/tmp/project-one', 'Review changes', 1000, 2000, NULL);
      `);
    } finally {
      database.close();
    }

    const openCodeDashboardData = await readOpenCodeDashboardDataForHome({
      homePath,
      pathInfoReader,
    });

    assert.deepEqual(openCodeDashboardData.repoFolders, ["/tmp/project-one"]);
    assert.equal(openCodeDashboardData.warnings.length, 0);
    assert.deepEqual(openCodeDashboardData.threads, [
      {
        id: "openCode:ses_one",
        name: "Review changes",
        preview: "Review changes",
        cwd: "/tmp/project-one",
        path: null,
        source: "openCode",
        modelProvider: "openCode",
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        status: { type: "idle" },
        gitInfo: null,
      },
    ]);
  });
});
