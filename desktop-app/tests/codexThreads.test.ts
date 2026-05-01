import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { readCodexThreadsFromSessionRoot } from "../src/main/codexThreads";

const withSessionRoot = async (
  runTest: (sessionsPath: string) => Promise<void>,
) => {
  const sessionsPath = await mkdtemp(join(tmpdir(), "molttree-sessions-"));

  try {
    await runTest(sessionsPath);
  } finally {
    await rm(sessionsPath, { recursive: true, force: true });
  }
};

const writeSessionFile = async ({
  path,
  lines,
  updatedAt,
}: {
  path: string;
  lines: unknown[];
  updatedAt: Date;
}) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  await utimes(path, updatedAt, updatedAt);
};

test("reads codex threads from root and nested session files", async () => {
  await withSessionRoot(async (sessionsPath) => {
    const nestedSessionPath = join(
      sessionsPath,
      "2026",
      "05",
      "01",
      "rollout-2026-05-01T01-00-00-aaa.jsonl",
    );
    const rootSessionPath = join(
      sessionsPath,
      "rollout-2026-05-01T02-00-00-bbb.jsonl",
    );
    const nestedUpdatedAt = new Date("2026-05-01T01:05:00.000Z");
    const rootUpdatedAt = new Date("2026-05-01T02:05:00.000Z");

    await writeSessionFile({
      path: nestedSessionPath,
      updatedAt: nestedUpdatedAt,
      lines: [
        {
          timestamp: "2026-05-01T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "nested-thread",
            timestamp: "2026-05-01T01:00:00.000Z",
            cwd: "/repo/nested",
            source: "vscode",
            model_provider: "openai",
            git: {
              commit_hash: "abc123",
              branch: "main",
              repository_url: "https://github.com/example/repo.git",
            },
          },
        },
        {
          timestamp: "2026-05-01T01:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "nested\nprompt",
          },
        },
      ],
    });
    await writeSessionFile({
      path: rootSessionPath,
      updatedAt: rootUpdatedAt,
      lines: [
        {
          timestamp: "2026-05-01T02:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "root-thread",
            timestamp: "2026-05-01T02:00:00.000Z",
            cwd: "/repo/root",
            originator: "codex_cli",
            model_provider: "openai",
          },
        },
        {
          timestamp: "2026-05-01T02:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "root prompt",
          },
        },
      ],
    });

    const threads = await readCodexThreadsFromSessionRoot({ sessionsPath });
    const nestedThread = threads.find(
      (thread) => thread.id === "nested-thread",
    );
    const rootThread = threads.find((thread) => thread.id === "root-thread");

    assert.deepEqual(
      threads.map((thread) => thread.id),
      ["root-thread", "nested-thread"],
    );
    assert.equal(rootThread?.cwd, "/repo/root");
    assert.equal(rootThread?.source, "codex_cli");
    assert.equal(rootThread?.preview, "root prompt");
    assert.equal(
      rootThread?.updatedAt,
      Math.floor(rootUpdatedAt.getTime() / 1000),
    );
    assert.equal(nestedThread?.cwd, "/repo/nested");
    assert.equal(nestedThread?.path, nestedSessionPath);
    assert.equal(nestedThread?.preview, "nested prompt");
    assert.equal(
      nestedThread?.createdAt,
      Math.floor(new Date("2026-05-01T01:00:00.000Z").getTime() / 1000),
    );
    assert.deepEqual(nestedThread?.gitInfo, {
      sha: "abc123",
      branch: "main",
      originUrl: "https://github.com/example/repo.git",
    });
  });
});

test("ignores non-session files and malformed session files", async () => {
  await withSessionRoot(async (sessionsPath) => {
    await writeFile(join(sessionsPath, "notes.jsonl"), "{}\n");
    await writeSessionFile({
      path: join(sessionsPath, "rollout-2026-05-01T01-00-00-bad.jsonl"),
      updatedAt: new Date("2026-05-01T01:05:00.000Z"),
      lines: [{ type: "event_msg", payload: { type: "user_message" } }],
    });

    assert.deepEqual(
      await readCodexThreadsFromSessionRoot({ sessionsPath }),
      [],
    );
  });
});
