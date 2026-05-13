import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  readOpenCodeDatabasePath,
  readCodexDashboardData,
  readChatProviderProjectOpenTarget,
  readOpenCodeDashboardDataForHome,
  readChatProviderDetectionsForHome,
  readOpenCodeProjectDataPath,
} from "../src/main/chatProviders";

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
const readIsCodexNotDetected = async () => false;
const readIsCodexDetected = async () => true;

const withHomePath = async (runTest: (homePath: string) => Promise<void>) => {
  const homePath = await mkdtemp(
    join(tmpdir(), "branchmaster-chat-providers-"),
  );

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
      await readChatProviderDetectionsForHome({
        homePath,
        pathInfoReader,
        readIsCodexDetected: readIsCodexNotDetected,
      }),
      [
        { providerId: "codex", isDetected: false },
        { providerId: "openCode", isDetected: true },
      ],
    );
  });
});

test("detects Codex when its command is available", async () => {
  await withHomePath(async (homePath) => {
    assert.deepEqual(
      await readChatProviderDetectionsForHome({
        homePath,
        pathInfoReader,
        readIsCodexDetected,
      }),
      [
        { providerId: "codex", isDetected: true },
        { providerId: "openCode", isDetected: false },
      ],
    );
  });
});

test("reads the Codex project open command", () => {
  assert.deepEqual(
    readChatProviderProjectOpenTarget({
      providerId: "codex",
      path: "/tmp/project-one",
      platform: "darwin",
    }),
    {
      type: "command",
      command: "/Applications/Codex.app/Contents/MacOS/Codex",
      args: ["--open-project", "/tmp/project-one"],
    },
  );
});

test("reads the OpenCode project open URL", () => {
  assert.deepEqual(
    readChatProviderProjectOpenTarget({
      providerId: "openCode",
      path: "/tmp/project one",
      platform: "darwin",
    }),
    {
      type: "url",
      url: "opencode://open-project?directory=%2Ftmp%2Fproject+one",
    },
  );
});

test("rejects Codex project opening on platforms without a known app command", () => {
  assert.throws(
    () =>
      readChatProviderProjectOpenTarget({
        providerId: "codex",
        path: "/tmp/project-one",
        platform: "linux",
      }),
    /Opening projects in Codex is only supported on macOS\./,
  );
});

test("does not start Codex app-server when Codex is missing", async () => {
  let didReadAppServerClient = false;
  const codexDashboardData = await readCodexDashboardData({
    readIsCodexDetected: readIsCodexNotDetected,
    readAppServerClient: async () => {
      didReadAppServerClient = true;
      throw new Error("Codex should not start.");
    },
  });

  assert.equal(didReadAppServerClient, false);
  assert.deepEqual(codexDashboardData, {
    providerId: "codex",
    isDetected: false,
    repoFolders: [],
    threads: [],
    warnings: [],
  });
});

test("keeps dashboard reads alive when Codex app-server fails", async () => {
  const codexDashboardData = await readCodexDashboardData({
    readIsCodexDetected,
    readAppServerClient: async () => {
      throw new Error("app-server failed");
    },
  });

  assert.deepEqual(codexDashboardData, {
    providerId: "codex",
    isDetected: true,
    repoFolders: [],
    threads: [],
    warnings: ["Codex: Failed to read chat data. app-server failed"],
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
      await readChatProviderDetectionsForHome({
        homePath,
        pathInfoReader,
        readIsCodexDetected: readIsCodexNotDetected,
      }),
      [
        { providerId: "codex", isDetected: false },
        { providerId: "openCode", isDetected: true },
      ],
    );
  });
});

test("does not detect OpenCode when its project data directory is missing", async () => {
  await withHomePath(async (homePath) => {
    assert.deepEqual(
      await readChatProviderDetectionsForHome({
        homePath,
        pathInfoReader,
        readIsCodexDetected: readIsCodexNotDetected,
      }),
      [
        { providerId: "codex", isDetected: false },
        { providerId: "openCode", isDetected: false },
      ],
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

    const openCodeDashboardData = await readOpenCodeDashboardDataForHome({
      homePath,
      pathInfoReader,
    });

    assert.deepEqual(openCodeDashboardData.repoFolders, [
      { providerId: "openCode", path: "/tmp/project-one" },
      { providerId: "openCode", path: "/tmp/project-two" },
    ]);
    assert.deepEqual(openCodeDashboardData.warnings, []);
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

    assert.equal(openCodeDashboardData.providerId, "openCode");
    assert.equal(openCodeDashboardData.isDetected, true);
    assert.deepEqual(openCodeDashboardData.repoFolders, [
      { providerId: "openCode", path: "/tmp/project-one" },
    ]);
    assert.equal(openCodeDashboardData.warnings.length, 0);
    assert.deepEqual(openCodeDashboardData.threads, [
      {
        id: "openCode:ses_one",
        providerId: "openCode",
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
