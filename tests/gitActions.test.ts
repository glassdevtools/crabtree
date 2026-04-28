import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  checkoutGitCommit,
  commitAllGitChanges,
  createGitBranch,
  deleteGitBranch,
  mergeGitBranch,
  moveGitBranch,
  previewGitMerge,
  pushGitBranchTagChanges,
  resetGitBranchTagChanges,
  stageGitChanges,
  unstageGitChanges,
} from "../src/main/gitActions";
import { readGitChangesOfCwd, readRepoGraphs } from "../src/main/gitData";
import type { CodexThread } from "../src/shared/types";

const execFileAsync = promisify(execFile);

type GitRepo = {
  repoRoot: string;
};

type GitRepoWithOrigin = {
  parentRoot: string;
  repoRoot: string;
  originRoot: string;
  mainSha: string;
};

const runGit = async ({ cwd, args }: { cwd: string; args: string[] }) => {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });

  return stdout.trim();
};

const writeRepoFile = async ({
  repoRoot,
  filePath,
  content,
}: {
  repoRoot: string;
  filePath: string;
  content: string;
}) => {
  const absolutePath = join(repoRoot, filePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

const appendRepoFile = async ({
  repoRoot,
  filePath,
  content,
}: {
  repoRoot: string;
  filePath: string;
  content: string;
}) => {
  const absolutePath = join(repoRoot, filePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, content);
};

const readRepoFile = async ({
  repoRoot,
  filePath,
}: {
  repoRoot: string;
  filePath: string;
}) => {
  return await readFile(join(repoRoot, filePath), "utf8");
};

const readSha = async ({ cwd, ref }: { cwd: string; ref: string }) => {
  return await runGit({ cwd, args: ["rev-parse", "--verify", ref] });
};

const readOptionalSha = async ({ cwd, ref }: { cwd: string; ref: string }) => {
  try {
    return await readSha({ cwd, ref });
  } catch {
    return null;
  }
};

const commitRepoFile = async ({
  repoRoot,
  filePath,
  content,
  message,
}: {
  repoRoot: string;
  filePath: string;
  content: string;
  message: string;
}) => {
  await writeRepoFile({ repoRoot, filePath, content });
  await runGit({ cwd: repoRoot, args: ["add", "--", filePath] });
  await runGit({ cwd: repoRoot, args: ["commit", "-m", message] });

  return await readSha({ cwd: repoRoot, ref: "HEAD" });
};

const createRepo = async () => {
  const repoRoot = await realpath(
    await mkdtemp(join(tmpdir(), "molttree-git-")),
  );

  await runGit({
    cwd: repoRoot,
    args: ["init", "--initial-branch=main"],
  });
  await runGit({
    cwd: repoRoot,
    args: ["config", "user.email", "tests@example.com"],
  });
  await runGit({
    cwd: repoRoot,
    args: ["config", "user.name", "MoltTree Tests"],
  });

  return { repoRoot };
};

const withRepo = async (runTest: ({ repoRoot }: GitRepo) => Promise<void>) => {
  const repo = await createRepo();

  try {
    await runTest(repo);
  } finally {
    await rm(repo.repoRoot, { recursive: true, force: true });
  }
};

const createRepoWithOrigin = async () => {
  const parentRoot = await realpath(
    await mkdtemp(join(tmpdir(), "molttree-git-origin-")),
  );
  const originRoot = join(parentRoot, "origin.git");
  const repoRoot = join(parentRoot, "repo");

  await runGit({
    cwd: parentRoot,
    args: ["init", "--bare", "--initial-branch=main", originRoot],
  });
  await runGit({ cwd: parentRoot, args: ["clone", originRoot, repoRoot] });
  await runGit({
    cwd: repoRoot,
    args: ["config", "user.email", "tests@example.com"],
  });
  await runGit({
    cwd: repoRoot,
    args: ["config", "user.name", "MoltTree Tests"],
  });
  const mainSha = await commitRepoFile({
    repoRoot,
    filePath: "base.txt",
    content: "base\n",
    message: "base",
  });
  await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "main"] });
  await runGit({
    cwd: repoRoot,
    args: ["remote", "set-head", "origin", "main"],
  });

  return { parentRoot, repoRoot, originRoot, mainSha };
};

const withOriginRepo = async (
  runTest: ({
    parentRoot,
    repoRoot,
    originRoot,
    mainSha,
  }: GitRepoWithOrigin) => Promise<void>,
) => {
  const repo = await createRepoWithOrigin();

  try {
    await runTest(repo);
  } finally {
    await rm(repo.parentRoot, { recursive: true, force: true });
  }
};

const createThread = ({ id, cwd }: { id: string; cwd: string }) => {
  const thread: CodexThread = {
    id,
    name: null,
    preview: id,
    cwd,
    path: null,
    source: "test",
    modelProvider: "test",
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    status: { type: "idle" },
    gitInfo: null,
  };

  return thread;
};

// -------------------------- Git graph reads ---------------

test("reads repo graphs with commits, worktrees, and branch tag changes", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    const newSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\nlocal\n",
      message: "feature local",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    const worktreeRoot = join(parentRoot, "feature-worktree");

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "feature"],
    });

    const threads = [
      createThread({ id: "root-thread", cwd: repoRoot }),
      createThread({ id: "worktree-thread", cwd: worktreeRoot }),
    ];
    const { repos, warnings, gitErrors } = await readRepoGraphs({ threads });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.equal(repos.length, 1);
    assert.equal(repo?.root, repoRoot);
    assert.equal(repo?.currentBranch, "main");
    assert.equal(repo?.defaultBranch, "main");
    assert.deepEqual(repo?.threadIds.sort(), [
      "root-thread",
      "worktree-thread",
    ]);
    assert.deepEqual(repo?.branchTagChanges, [
      { repoRoot, branch: "feature", oldSha, newSha },
    ]);
    assert.equal(repo?.worktrees.length, 1);
    assert.equal(repo?.worktrees[0]?.path, worktreeRoot);
    assert.equal(repo?.worktrees[0]?.branch, "feature");
    assert.equal(repo?.worktrees[0]?.head, newSha);

    const featureCommit = repo?.commits.find((commit) => commit.sha === newSha);

    assert.notEqual(featureCommit, undefined);
    assert.equal(featureCommit?.localBranches.includes("feature"), true);
    assert.deepEqual(featureCommit?.threadIds, ["worktree-thread"]);
  });
});

test("reads a missing local branch as a branch tag deletion", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await runGit({ cwd: repoRoot, args: ["branch", "-D", "feature"] });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.deepEqual(repo?.branchTagChanges, [
      { repoRoot, branch: "feature", oldSha, newSha: null },
    ]);
  });
});

test("reads staged and unstaged change summaries for repo and worktree cwd values", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    const worktreeRoot = join(parentRoot, "feature-worktree");

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "feature"],
    });

    const threads = [
      createThread({ id: "root-thread", cwd: repoRoot }),
      createThread({ id: "worktree-thread", cwd: worktreeRoot }),
    ];
    const repoGraphResult = await readRepoGraphs({ threads });

    await appendRepoFile({
      repoRoot,
      filePath: "base.txt",
      content: "root staged\n",
    });
    await runGit({ cwd: repoRoot, args: ["add", "--", "base.txt"] });
    await appendRepoFile({
      repoRoot: worktreeRoot,
      filePath: "feature.txt",
      content: "worktree unstaged\n",
    });

    const { gitChangesOfCwd, gitErrors } = await readGitChangesOfCwd({
      threads,
      repos: repoGraphResult.repos,
    });

    assert.equal(gitErrors.length, 0);
    assert.equal(gitChangesOfCwd[repoRoot]?.staged.added, 1);
    assert.equal(gitChangesOfCwd[repoRoot]?.unstaged.added, 0);
    assert.equal(gitChangesOfCwd[worktreeRoot]?.staged.added, 0);
    assert.equal(gitChangesOfCwd[worktreeRoot]?.unstaged.added, 1);
  });
});

// -------------------------- Local working tree actions ---------------

test("stages and unstages all changes in a repo path", async () => {
  await withRepo(async ({ repoRoot }) => {
    await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });
    await writeRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\ntwo\n",
    });

    await stageGitChanges(repoRoot);

    assert.equal(
      await runGit({
        cwd: repoRoot,
        args: ["diff", "--cached", "--name-only"],
      }),
      "file.txt",
    );

    await unstageGitChanges(repoRoot);

    assert.equal(
      await runGit({
        cwd: repoRoot,
        args: ["diff", "--cached", "--name-only"],
      }),
      "",
    );
    assert.equal(
      await runGit({ cwd: repoRoot, args: ["diff", "--name-only"] }),
      "file.txt",
    );
  });
});

test("commits all changes and advances colocated local branch tags", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });
    await runGit({ cwd: repoRoot, args: ["branch", "topic", oldSha] });
    await appendRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "two\n",
    });

    const newSha = await commitAllGitChanges({
      path: repoRoot,
      message: "second",
    });

    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), newSha);
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/heads/topic" }),
      newSha,
    );
    assert.equal(
      await runGit({ cwd: repoRoot, args: ["rev-parse", `${newSha}^`] }),
      oldSha,
    );
  });
});

test("creates a branch at the current HEAD", async () => {
  await withRepo(async ({ repoRoot }) => {
    const headSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });

    await createGitBranch({ path: repoRoot, branch: "created" });

    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/heads/created" }),
      headSha,
    );
  });
});

// -------------------------- Branch tag deletion ---------------

test("deletes a branch when another ref keeps its tip visible", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });
    await runGit({ cwd: repoRoot, args: ["branch", "keep", oldSha] });
    await runGit({ cwd: repoRoot, args: ["branch", "delete-me", oldSha] });

    await deleteGitBranch({
      repoRoot,
      branch: "delete-me",
      oldSha,
    });

    assert.equal(
      await readOptionalSha({ cwd: repoRoot, ref: "delete-me" }),
      null,
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "keep" }), oldSha);
  });
});

test("rejects deleting the only ref that keeps a commit visible", async () => {
  await withRepo(async ({ repoRoot }) => {
    await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic"] });
    const topicSha = await commitRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "topic\n",
      message: "topic",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });

    await assert.rejects(async () => {
      await deleteGitBranch({
        repoRoot,
        branch: "topic",
        oldSha: topicSha,
      });
    }, /hide commits/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), topicSha);
  });
});

test("rejects deleting a branch when the old sha is stale", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic"] });
    const topicSha = await commitRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "topic\n",
      message: "topic",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });

    await assert.rejects(async () => {
      await deleteGitBranch({
        repoRoot,
        branch: "topic",
        oldSha,
      });
    }, /moved/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), topicSha);
  });
});

// -------------------------- Branch pointer moves ---------------

test("moves a branch to a descendant commit", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["branch", "topic", oldSha] });
    const newSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\nmain\n",
      message: "main",
    });

    await moveGitBranch({
      repoRoot,
      branch: "topic",
      oldSha,
      newSha,
    });

    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), newSha);
  });
});

test("rejects moving a branch when its old tip would disappear from the graph", async () => {
  await withRepo(async ({ repoRoot }) => {
    const baseSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic"] });
    const topicSha = await commitRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "topic\n",
      message: "topic",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });

    await assert.rejects(async () => {
      await moveGitBranch({
        repoRoot,
        branch: "topic",
        oldSha: topicSha,
        newSha: baseSha,
      });
    }, /hide commits/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), topicSha);
  });
});

test("resets a checked-out branch to a safe target commit", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "target"] });
    const targetSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\ntarget\n",
      message: "target",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });

    await moveGitBranch({
      repoRoot,
      branch: "main",
      oldSha,
      newSha: targetSha,
    });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "main",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), targetSha);
    assert.equal(
      await readRepoFile({ repoRoot, filePath: "file.txt" }),
      "base\ntarget\n",
    );
  });
});

test("rejects moving a checked-out branch with a dirty working tree", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "target"] });
    const targetSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\ntarget\n",
      message: "target",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await appendRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "dirty\n",
    });

    await assert.rejects(async () => {
      await moveGitBranch({
        repoRoot,
        branch: "main",
        oldSha,
        newSha: targetSha,
      });
    }, /clean/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), oldSha);
  });
});

// -------------------------- Checkout and merge ---------------

test("switches HEAD to a commit only when the current HEAD remains visible", async () => {
  await withRepo(async ({ repoRoot }) => {
    const firstSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "one",
    });
    const secondSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\ntwo\n",
      message: "two",
    });

    await checkoutGitCommit({ repoRoot, sha: firstSha });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), firstSha);

    const detachedSha = await commitRepoFile({
      repoRoot,
      filePath: "detached.txt",
      content: "detached\n",
      message: "detached",
    });

    await assert.rejects(async () => {
      await checkoutGitCommit({ repoRoot, sha: secondSha });
    }, /reachable/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), detachedSha);
  });
});

test("rejects checkout when the working tree is dirty", async () => {
  await withRepo(async ({ repoRoot }) => {
    const firstSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "one",
    });
    await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\ntwo\n",
      message: "two",
    });
    await appendRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "dirty\n",
    });

    await assert.rejects(async () => {
      await checkoutGitCommit({ repoRoot, sha: firstSha });
    }, /clean/);
  });
});

test("previews and merges a branch into HEAD", async () => {
  await withRepo(async ({ repoRoot }) => {
    await commitRepoFile({
      repoRoot,
      filePath: "base.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await commitRepoFile({
      repoRoot,
      filePath: "main.txt",
      content: "main\n",
      message: "main",
    });

    const preview = await previewGitMerge({ repoRoot, branch: "feature" });

    assert.equal(preview.added, 1);
    assert.equal(preview.removed, 0);
    assert.equal(preview.conflictCount, 0);

    await mergeGitBranch({ repoRoot, branch: "feature" });

    assert.equal(
      await runGit({
        cwd: repoRoot,
        args: ["rev-list", "--parents", "-n", "1", "HEAD"],
      }).then((line) => line.split(" ").length),
      3,
    );
    assert.equal(
      await readRepoFile({ repoRoot, filePath: "feature.txt" }),
      "feature\n",
    );
  });
});

test("rejects merge when the working tree is dirty", async () => {
  await withRepo(async ({ repoRoot }) => {
    await commitRepoFile({
      repoRoot,
      filePath: "base.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await appendRepoFile({
      repoRoot,
      filePath: "base.txt",
      content: "dirty\n",
    });

    await assert.rejects(async () => {
      await mergeGitBranch({ repoRoot, branch: "feature" });
    }, /clean/);
  });
});

// -------------------------- Origin branch tag changes ---------------

test("pushes a safe branch tag update to origin", async () => {
  await withOriginRepo(async ({ repoRoot, originRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    const newSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\nmore\n",
      message: "feature more",
    });

    await pushGitBranchTagChanges([
      { repoRoot, branch: "feature", oldSha, newSha },
    ]);

    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/heads/feature" }),
      newSha,
    );
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/remotes/origin/feature" }),
      newSha,
    );
  });
});

test("rejects pushing a branch tag update that would hide the old origin tip", async () => {
  await withOriginRepo(async ({ repoRoot, originRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await runGit({ cwd: repoRoot, args: ["branch", "-f", "feature", mainSha] });

    await assert.rejects(async () => {
      await pushGitBranchTagChanges([
        { repoRoot, branch: "feature", oldSha, newSha: mainSha },
      ]);
    }, /hide commits/);

    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/heads/feature" }),
      oldSha,
    );
  });
});

test("rejects pushing an unsafe origin branch deletion", async () => {
  await withOriginRepo(async ({ repoRoot, originRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await runGit({ cwd: repoRoot, args: ["branch", "-D", "feature"] });

    await assert.rejects(async () => {
      await pushGitBranchTagChanges([
        { repoRoot, branch: "feature", oldSha, newSha: null },
      ]);
    }, /hide commits/);

    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/heads/feature" }),
      oldSha,
    );
  });
});

test("pushes an origin branch deletion when another origin ref keeps the old tip visible", async () => {
  await withOriginRepo(async ({ repoRoot, originRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    await runGit({ cwd: repoRoot, args: ["branch", "keep-feature", oldSha] });
    await runGit({
      cwd: repoRoot,
      args: ["push", "-u", "origin", "keep-feature"],
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await runGit({ cwd: repoRoot, args: ["branch", "-D", "feature"] });

    await pushGitBranchTagChanges([
      { repoRoot, branch: "feature", oldSha, newSha: null },
    ]);

    assert.equal(
      await readOptionalSha({ cwd: originRoot, ref: "refs/heads/feature" }),
      null,
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "keep-feature" }), oldSha);
    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/heads/keep-feature" }),
      oldSha,
    );
  });
});

test("rejects resetting a local branch when its local tip would disappear", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    const newSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\nlocal\n",
      message: "feature local",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });

    await assert.rejects(async () => {
      await resetGitBranchTagChanges([
        { repoRoot, branch: "feature", oldSha, newSha },
      ]);
    }, /hide commits/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "feature" }), newSha);
  });
});

test("resets a local branch when another ref keeps the local tip visible", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    const newSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\nlocal\n",
      message: "feature local",
    });
    await runGit({
      cwd: repoRoot,
      args: ["tag", "keep-local-feature", newSha],
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });

    await resetGitBranchTagChanges([
      { repoRoot, branch: "feature", oldSha, newSha },
    ]);

    assert.equal(await readSha({ cwd: repoRoot, ref: "feature" }), oldSha);
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "keep-local-feature" }),
      newSha,
    );
  });
});

test("recreates a missing local branch from origin during reset", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    await runGit({ cwd: repoRoot, args: ["branch", "-D", "feature"] });

    await resetGitBranchTagChanges([
      { repoRoot, branch: "feature", oldSha, newSha: null },
    ]);

    assert.equal(await readSha({ cwd: repoRoot, ref: "feature" }), oldSha);
  });
});
