import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  appendFile,
  chmod,
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
  createGitPullRequest,
  createGitRef,
  deleteGitBranch,
  deleteGitTag,
  mergeGitBranch,
  moveGitBranch,
  previewGitMerge,
  pushGitBranchSyncChanges,
  readGitMainWorktreePathForPath,
  revertGitBranchSyncChanges,
  stageGitChanges,
  switchGitBranch,
  unstageGitChanges,
} from "../src/main/gitActions";
import { readDashboardDataAfterGitMutation } from "../src/main/dashboard";
import {
  readGitChangesOfCwd,
  readRepoGraphs,
  readRepoGraphsForRepoRoots,
} from "../src/main/gitData";
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

test("reads repo graphs with commits, worktrees, and branch sync changes", async () => {
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
    assert.deepEqual(repo?.branchSyncChanges, [
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha: newSha,
        originSha: oldSha,
      },
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

test("reads repo graphs when a linked worktree branch is missing", async () => {
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
    const gitCommonDir = await runGit({
      cwd: repoRoot,
      args: ["rev-parse", "--git-common-dir"],
    });
    await rm(join(repoRoot, gitCommonDir, "refs/heads/feature"), {
      force: true,
    });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.equal(repo?.worktrees[0]?.path, worktreeRoot);
    assert.equal(repo?.worktrees[0]?.branch, "feature");
    assert.equal(repo?.worktrees[0]?.head, null);
  });
});

test("reads a missing local branch as an origin-only branch sync change", async () => {
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
    assert.deepEqual(repo?.branchSyncChanges, [
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha: null,
        originSha: oldSha,
      },
    ]);
  });
});

test("reads a missing origin branch as a local-only branch sync change", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const localSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.deepEqual(repo?.branchSyncChanges, [
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha,
        originSha: null,
      },
    ]);
  });
});

test("reads a missing origin tag as a local-only tag sync change", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "local-tag", mainSha] });
    const localSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/local-tag",
    });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.deepEqual(repo?.branchSyncChanges, [
      {
        repoRoot,
        gitRefType: "tag",
        name: "local-tag",
        localSha,
        originSha: null,
      },
    ]);
  });
});

test("fetches a missing local tag from origin", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "remote-tag", mainSha] });
    const originSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/remote-tag",
    });
    await runGit({
      cwd: repoRoot,
      args: ["push", "origin", "refs/tags/remote-tag"],
    });
    await runGit({ cwd: repoRoot, args: ["tag", "-d", "remote-tag"] });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.deepEqual(repo?.branchSyncChanges, []);
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/tags/remote-tag" }),
      originSha,
    );
  });
});

test("does not overwrite a changed local tag while fetching origin", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "shared-tag", mainSha] });
    const originSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/shared-tag",
    });
    await runGit({
      cwd: repoRoot,
      args: ["push", "origin", "refs/tags/shared-tag"],
    });
    const localSha = await runGit({
      cwd: repoRoot,
      args: ["commit-tree", `${mainSha}^{tree}`, "-m", "local"],
    });
    await runGit({
      cwd: repoRoot,
      args: ["tag", "-f", "shared-tag", localSha],
    });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.deepEqual(repo?.branchSyncChanges, [
      {
        repoRoot,
        gitRefType: "tag",
        name: "shared-tag",
        localSha,
        originSha,
      },
    ]);
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/tags/shared-tag" }),
      localSha,
    );
  });
});

test("reads local branches as branch sync changes when origin tracking refs are empty", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({
      cwd: repoRoot,
      args: ["update-ref", "-d", "refs/remotes/origin/HEAD"],
    });
    await runGit({
      cwd: repoRoot,
      args: ["update-ref", "-d", "refs/remotes/origin/main"],
    });
    await runGit({
      cwd: repoRoot,
      args: ["remote", "set-url", "origin", "/tmp/molttree-missing-origin.git"],
    });
    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /Failed to fetch origin/);
    assert.equal(gitErrors.length, 0);
    assert.deepEqual(repo?.branchSyncChanges, [
      {
        repoRoot,
        gitRefType: "branch",
        name: "main",
        localSha: mainSha,
        originSha: null,
      },
    ]);
  });
});

test("reads the remote default branch when origin head tracking ref is missing", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({
      cwd: repoRoot,
      args: ["update-ref", "-d", "refs/remotes/origin/HEAD"],
    });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "root-thread", cwd: repoRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.equal(repo?.defaultBranch, "main");
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
    await writeRepoFile({
      repoRoot,
      filePath: "root-untracked.txt",
      content: "root untracked one\nroot untracked two\n",
    });
    await appendRepoFile({
      repoRoot: worktreeRoot,
      filePath: "feature.txt",
      content: "worktree unstaged\n",
    });
    await writeRepoFile({
      repoRoot: worktreeRoot,
      filePath: "worktree-untracked.txt",
      content: "worktree untracked one\nworktree untracked two",
    });

    const { gitChangesOfCwd, gitErrors } = await readGitChangesOfCwd({
      threads,
      repos: repoGraphResult.repos,
    });

    assert.equal(gitErrors.length, 0);
    assert.equal(gitChangesOfCwd[repoRoot]?.staged.added, 1);
    assert.equal(gitChangesOfCwd[repoRoot]?.unstaged.added, 2);
    assert.equal(gitChangesOfCwd[worktreeRoot]?.staged.added, 0);
    assert.equal(gitChangesOfCwd[worktreeRoot]?.unstaged.added, 3);
  });
});

test("uses the main worktree as the repo root for linked worktree threads", async () => {
  await withRepo(async ({ repoRoot }) => {
    await commitRepoFile({
      repoRoot,
      filePath: "base.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const featureSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    const worktreeRoot = `${repoRoot}-feature-worktree`;

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "feature"],
    });

    const { repos, warnings, gitErrors } = await readRepoGraphs({
      threads: [createThread({ id: "worktree-thread", cwd: worktreeRoot })],
    });
    const repo = repos[0];

    assert.equal(warnings.length, 0);
    assert.equal(gitErrors.length, 0);
    assert.equal(repo?.root, repoRoot);
    assert.equal(repo?.mainWorktreePath, repoRoot);
    assert.equal(repo?.currentBranch, "main");
    assert.deepEqual(repo?.threadIds, ["worktree-thread"]);
    assert.equal(repo?.worktrees[0]?.path, worktreeRoot);
    assert.equal(repo?.worktrees[0]?.branch, "feature");
    assert.equal(repo?.worktrees[0]?.head, featureSha);
  });
});

test("reads main worktree changes even when every thread is in a linked worktree", async () => {
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
    const worktreeRoot = `${repoRoot}-feature-worktree`;

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "feature"],
    });

    const threads = [
      createThread({ id: "worktree-thread", cwd: worktreeRoot }),
    ];
    const repoGraphResult = await readRepoGraphs({ threads });

    await appendRepoFile({
      repoRoot,
      filePath: "base.txt",
      content: "main unstaged\n",
    });
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
    assert.equal(gitChangesOfCwd[repoRoot]?.unstaged.added, 1);
    assert.equal(gitChangesOfCwd[worktreeRoot]?.unstaged.added, 1);
  });
});

test("rereads only requested repo graphs after a git mutation", async () => {
  await withRepo(async ({ repoRoot: repoRootOne }) => {
    await withRepo(async ({ repoRoot: repoRootTwo }) => {
      const oneSha = await commitRepoFile({
        repoRoot: repoRootOne,
        filePath: "one.txt",
        content: "one\n",
        message: "one",
      });
      await commitRepoFile({
        repoRoot: repoRootTwo,
        filePath: "two.txt",
        content: "two\n",
        message: "two",
      });
      const threads = [
        createThread({ id: "one-thread", cwd: repoRootOne }),
        createThread({ id: "two-thread", cwd: repoRootTwo }),
      ];
      const fullGraphResult = await readRepoGraphs({ threads });
      const previousRepoOne = fullGraphResult.repos.find(
        (repo) => repo.root === repoRootOne,
      );
      const previousRepoTwo = fullGraphResult.repos.find(
        (repo) => repo.root === repoRootTwo,
      );

      assert.notEqual(previousRepoOne, undefined);
      assert.notEqual(previousRepoTwo, undefined);

      await createGitRef({
        repoRoot: repoRootOne,
        gitRefType: "tag",
        name: "saved-tag",
        sha: oneSha,
      });

      const nextGraphResult = await readRepoGraphsForRepoRoots({
        threads,
        repos: fullGraphResult.repos,
        repoRoots: [repoRootOne],
      });
      const nextRepoOne = nextGraphResult.repos.find(
        (repo) => repo.root === repoRootOne,
      );
      const nextRepoTwo = nextGraphResult.repos.find(
        (repo) => repo.root === repoRootTwo,
      );
      const taggedCommit = nextRepoOne?.commits.find(
        (commit) => commit.sha === oneSha,
      );

      assert.equal(nextGraphResult.warnings.length, 0);
      assert.equal(nextGraphResult.gitErrors.length, 0);
      assert.notEqual(nextRepoOne, previousRepoOne);
      assert.equal(nextRepoTwo, previousRepoTwo);
      assert.equal(taggedCommit?.refs.includes("tag: saved-tag"), true);
    });
  });
});

test("updates changed repo change summaries after a git mutation", async () => {
  await withRepo(async ({ repoRoot: repoRootOne }) => {
    await withRepo(async ({ repoRoot: repoRootTwo }) => {
      await commitRepoFile({
        repoRoot: repoRootOne,
        filePath: "one.txt",
        content: "one\n",
        message: "one",
      });
      await commitRepoFile({
        repoRoot: repoRootTwo,
        filePath: "two.txt",
        content: "two\n",
        message: "two",
      });
      await appendRepoFile({
        repoRoot: repoRootTwo,
        filePath: "two.txt",
        content: "two changed\n",
      });

      const threads = [
        createThread({ id: "one-thread", cwd: repoRootOne }),
        createThread({ id: "two-thread", cwd: repoRootTwo }),
      ];
      const repoGraphResult = await readRepoGraphs({ threads });
      const gitChangeResult = await readGitChangesOfCwd({
        threads,
        repos: repoGraphResult.repos,
      });
      const previousDashboardData = {
        generatedAt: "2026-04-30T00:00:00.000Z",
        repos: repoGraphResult.repos,
        threads,
        gitChangesOfCwd: gitChangeResult.gitChangesOfCwd,
        gitErrors: gitChangeResult.gitErrors,
        warnings: repoGraphResult.warnings,
      };

      await appendRepoFile({
        repoRoot: repoRootOne,
        filePath: "one.txt",
        content: "one changed\n",
      });

      const nextDashboardData = await readDashboardDataAfterGitMutation({
        previousDashboardData,
        repoRoots: [repoRootOne],
      });

      assert.equal(nextDashboardData.gitErrors.length, 0);
      assert.equal(
        nextDashboardData.gitChangesOfCwd[repoRootOne]?.unstaged.added,
        1,
      );
      assert.equal(
        nextDashboardData.gitChangesOfCwd[repoRootTwo]?.unstaged.added,
        1,
      );
    });
  });
});

test("reads the main worktree path from a linked worktree path", async () => {
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
    const worktreeRoot = `${repoRoot}-feature-worktree`;

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "feature"],
    });

    assert.equal(
      await readGitMainWorktreePathForPath({ path: worktreeRoot }),
      repoRoot,
    );
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

test("keeps a successful commit when a colocated branch tag moves first", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });
    await runGit({ cwd: repoRoot, args: ["branch", "topic", oldSha] });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "side", oldSha] });
    const sideSha = await commitRepoFile({
      repoRoot,
      filePath: "side.txt",
      content: "side\n",
      message: "side",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    const hookPath = join(repoRoot, ".git", "hooks", "post-commit");
    await writeFile(
      hookPath,
      `#!/bin/sh\ngit update-ref refs/heads/topic ${sideSha} ${oldSha}\n`,
    );
    await chmod(hookPath, 0o755);
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
      sideSha,
    );
    assert.equal(
      await runGit({ cwd: repoRoot, args: ["rev-parse", `${newSha}^`] }),
      oldSha,
    );
  });
});

test("creates and attaches a branch at the current HEAD", async () => {
  await withRepo(async ({ repoRoot }) => {
    const headSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });

    await createGitBranch({
      path: repoRoot,
      branch: "created",
      expectedHeadSha: headSha,
    });

    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/heads/created" }),
      headSha,
    );
    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "created",
    );
  });
});

test("creates and attaches a branch in a dirty detached worktree without changing files", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot, mainSha }) => {
    const worktreeRoot = join(parentRoot, "worktree");

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", "--detach", worktreeRoot, mainSha],
    });
    await appendRepoFile({
      repoRoot: worktreeRoot,
      filePath: "base.txt",
      content: "dirty\n",
    });

    await createGitBranch({
      path: worktreeRoot,
      branch: "created",
      expectedHeadSha: mainSha,
    });

    assert.equal(
      await runGit({ cwd: worktreeRoot, args: ["branch", "--show-current"] }),
      "created",
    );
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/heads/created" }),
      mainSha,
    );
    assert.equal(
      await readRepoFile({ repoRoot: worktreeRoot, filePath: "base.txt" }),
      "base\ndirty\n",
    );

    const { repos } = await readRepoGraphs({
      threads: [createThread({ id: "thread", cwd: worktreeRoot })],
    });
    const repo = repos[0];

    assert.ok(repo !== undefined);
    assert.equal(
      repo.worktrees.find((worktree) => worktree.path === worktreeRoot)?.branch,
      "created",
    );
  });
});

test("rejects creating a branch when the worktree HEAD moved", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "one",
    });
    await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "two\n",
      message: "two",
    });

    await assert.rejects(async () => {
      await createGitBranch({
        path: repoRoot,
        branch: "created",
        expectedHeadSha: oldSha,
      });
    }, /HEAD moved/);
  });
});

test("creates branch and tag refs at a commit without switching HEAD", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\nnew\n",
      message: "new",
    });

    await createGitRef({
      repoRoot,
      gitRefType: "branch",
      name: "saved-branch",
      sha: oldSha,
    });
    await createGitRef({
      repoRoot,
      gitRefType: "tag",
      name: "saved-tag",
      sha: oldSha,
    });

    assert.equal(await readSha({ cwd: repoRoot, ref: "saved-branch" }), oldSha);
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/tags/saved-tag^{commit}" }),
      oldSha,
    );
    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "main",
    );
  });
});

test("switches HEAD to the default branch when a checkout target has one", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["branch", "z-topic", mainSha] });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "side"] });
    await commitRepoFile({
      repoRoot,
      filePath: "side.txt",
      content: "side\n",
      message: "side",
    });

    await checkoutGitCommit({ repoRoot, sha: mainSha });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "main",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), mainSha);
  });
});

test("switches HEAD to the first local branch when a checkout target has no known default branch", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });
    await runGit({ cwd: repoRoot, args: ["branch", "topic-b", oldSha] });
    await runGit({ cwd: repoRoot, args: ["branch", "topic-a", oldSha] });
    await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\ntwo\n",
      message: "second",
    });

    await checkoutGitCommit({ repoRoot, sha: oldSha });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "topic-a",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), oldSha);
  });
});

test("detaches HEAD when every checkout target branch is already checked out in another worktree", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["branch", "target", mainSha] });
    await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "main\n",
      message: "main",
    });
    const worktreeRoot = join(parentRoot, "target-worktree");

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "target"],
    });

    await checkoutGitCommit({ repoRoot, sha: mainSha });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), mainSha);
  });
});

test("switches a dirty detached worktree to an existing branch at the same commit", async () => {
  await withRepo(async ({ repoRoot }) => {
    const headSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "one\n",
      message: "initial",
    });
    await runGit({ cwd: repoRoot, args: ["branch", "target", headSha] });
    const worktreeRoot = `${repoRoot}-detached-worktree`;

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", "--detach", worktreeRoot, headSha],
    });
    await appendRepoFile({
      repoRoot: worktreeRoot,
      filePath: "file.txt",
      content: "dirty\n",
    });

    await switchGitBranch({
      repoRoot,
      path: worktreeRoot,
      branch: "target",
      oldSha: headSha,
      newSha: headSha,
    });

    assert.equal(
      await runGit({ cwd: worktreeRoot, args: ["branch", "--show-current"] }),
      "target",
    );
    assert.equal(
      await runGit({ cwd: worktreeRoot, args: ["status", "--porcelain"] }),
      "M file.txt",
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

test("deletes a branch when it is the only ref that keeps a commit visible", async () => {
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

    await deleteGitBranch({
      repoRoot,
      branch: "topic",
      oldSha: topicSha,
    });

    assert.equal(await readOptionalSha({ cwd: repoRoot, ref: "topic" }), null);
  });
});

test("deletes the current branch by detaching HEAD", async () => {
  await withRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic"] });
    const topicSha = await commitRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "topic\n",
      message: "topic",
    });

    await deleteGitBranch({
      repoRoot,
      branch: "topic",
      oldSha: topicSha,
    });

    assert.equal(await readOptionalSha({ cwd: repoRoot, ref: "topic" }), null);
    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), topicSha);
  });
});

test("deletes the current branch and reattaches HEAD to the default branch at the same commit", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["branch", "topic", mainSha] });
    await runGit({ cwd: repoRoot, args: ["switch", "topic"] });

    await deleteGitBranch({
      repoRoot,
      branch: "topic",
      oldSha: mainSha,
    });

    assert.equal(await readOptionalSha({ cwd: repoRoot, ref: "topic" }), null);
    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "main",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), mainSha);
  });
});

test("rejects deleting a branch checked out in a linked worktree", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic"] });
    const topicSha = await commitRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "topic\n",
      message: "topic",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    const worktreeRoot = join(parentRoot, "topic-worktree");
    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "topic"],
    });

    await assert.rejects(async () => {
      await deleteGitBranch({
        repoRoot,
        branch: "topic",
        oldSha: topicSha,
      });
    }, /checked out in a worktree/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), topicSha);
    assert.equal(await readSha({ cwd: worktreeRoot, ref: "HEAD" }), topicSha);
  });
});

test("deletes the current branch from a linked worktree by detaching HEAD", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic"] });
    const topicSha = await commitRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "topic\n",
      message: "topic",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    const worktreeRoot = join(parentRoot, "topic-worktree");
    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "topic"],
    });

    await deleteGitBranch({
      repoRoot: worktreeRoot,
      branch: "topic",
      oldSha: topicSha,
    });

    assert.equal(await readOptionalSha({ cwd: repoRoot, ref: "topic" }), null);
    assert.equal(
      await runGit({ cwd: worktreeRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(await readSha({ cwd: worktreeRoot, ref: "HEAD" }), topicSha);
  });
});

test("rejects deleting the default branch", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    const mainSha = await readSha({ cwd: repoRoot, ref: "main" });
    await runGit({
      cwd: repoRoot,
      args: ["update-ref", "-d", "refs/remotes/origin/HEAD"],
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic"] });

    await assert.rejects(async () => {
      await deleteGitBranch({
        repoRoot,
        branch: "main",
        oldSha: mainSha,
      });
    }, /This is the default branch, so you can't delete it/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), mainSha);
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

test("deletes a lightweight tag", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["tag", "delete-me", oldSha] });

    await deleteGitTag({
      repoRoot,
      tag: "delete-me",
      oldSha,
    });

    assert.equal(
      await readOptionalSha({ cwd: repoRoot, ref: "refs/tags/delete-me" }),
      null,
    );
  });
});

test("deletes an annotated tag", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({
      cwd: repoRoot,
      args: ["tag", "-a", "annotated-delete-me", oldSha, "-m", "annotated"],
    });

    await deleteGitTag({
      repoRoot,
      tag: "annotated-delete-me",
      oldSha,
    });

    assert.equal(
      await readOptionalSha({
        cwd: repoRoot,
        ref: "refs/tags/annotated-delete-me",
      }),
      null,
    );
  });
});

test("rejects deleting a tag when the old sha is stale", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    const newSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\nnew\n",
      message: "new",
    });
    await runGit({ cwd: repoRoot, args: ["tag", "delete-me", newSha] });

    await assert.rejects(async () => {
      await deleteGitTag({
        repoRoot,
        tag: "delete-me",
        oldSha,
      });
    }, /moved/);

    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/tags/delete-me^{commit}" }),
      newSha,
    );
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
      sourcePath: null,
      targetPath: null,
    });

    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), newSha);
  });
});

test("moves a branch when its old tip would disappear from the graph", async () => {
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

    await moveGitBranch({
      repoRoot,
      branch: "topic",
      oldSha: topicSha,
      newSha: baseSha,
      sourcePath: null,
      targetPath: null,
    });

    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), baseSha);
  });
});

test("moves the current branch by detaching HEAD", async () => {
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
      sourcePath: repoRoot,
      targetPath: null,
    });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), oldSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), targetSha);
  });
});

test("detaches a dirty HEAD row from its branch without moving the branch", async () => {
  await withRepo(async ({ repoRoot }) => {
    const headSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\n",
      message: "base",
    });
    await appendRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "dirty\n",
    });

    await moveGitBranch({
      repoRoot,
      branch: "main",
      oldSha: headSha,
      newSha: headSha,
      sourcePath: repoRoot,
      targetPath: null,
    });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), headSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), headSha);
    assert.equal(
      await readRepoFile({ repoRoot, filePath: "file.txt" }),
      "base\ndirty\n",
    );
  });
});

test("moves the current branch and leaves HEAD detached at the old commit", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["branch", "topic", mainSha] });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "target", mainSha] });
    const targetSha = await commitRepoFile({
      repoRoot,
      filePath: "target.txt",
      content: "target\n",
      message: "target",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "topic"] });

    await moveGitBranch({
      repoRoot,
      branch: "topic",
      oldSha: mainSha,
      newSha: targetSha,
      sourcePath: repoRoot,
      targetPath: null,
    });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), mainSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "topic" }), targetSha);
  });
});

test("moves a branch onto a dirty HEAD row and attaches HEAD without changing files", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "topic", mainSha] });
    const targetSha = await commitRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "topic\n",
      message: "topic",
    });
    await appendRepoFile({
      repoRoot,
      filePath: "topic.txt",
      content: "dirty\n",
    });

    await moveGitBranch({
      repoRoot,
      branch: "main",
      oldSha: mainSha,
      newSha: targetSha,
      sourcePath: null,
      targetPath: repoRoot,
    });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "main",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), targetSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), targetSha);
    assert.equal(
      await readRepoFile({ repoRoot, filePath: "topic.txt" }),
      "topic\ndirty\n",
    );
  });
});

test("moves a branch onto a dirty linked worktree row and attaches that worktree without changing files", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["branch", "candidate", mainSha] });
    await runGit({ cwd: repoRoot, args: ["branch", "work", mainSha] });
    const worktreeRoot = join(parentRoot, "worktree");

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "work"],
    });
    const targetSha = await commitRepoFile({
      repoRoot: worktreeRoot,
      filePath: "work.txt",
      content: "work\n",
      message: "work",
    });
    await appendRepoFile({
      repoRoot: worktreeRoot,
      filePath: "work.txt",
      content: "dirty\n",
    });

    await moveGitBranch({
      repoRoot,
      branch: "candidate",
      oldSha: mainSha,
      newSha: targetSha,
      sourcePath: null,
      targetPath: worktreeRoot,
    });

    assert.equal(
      await runGit({ cwd: worktreeRoot, args: ["branch", "--show-current"] }),
      "candidate",
    );
    assert.equal(await readSha({ cwd: worktreeRoot, ref: "HEAD" }), targetSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "candidate" }), targetSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "work" }), targetSha);
    assert.equal(
      await readRepoFile({ repoRoot: worktreeRoot, filePath: "work.txt" }),
      "work\ndirty\n",
    );
  });
});

test("moves a branch between dirty worktree rows without changing files", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot }) => {
    const sourceSha = await commitRepoFile({
      repoRoot,
      filePath: "main.txt",
      content: "main\n",
      message: "main",
    });
    await appendRepoFile({
      repoRoot,
      filePath: "main.txt",
      content: "dirty\n",
    });
    await runGit({ cwd: repoRoot, args: ["branch", "work", sourceSha] });
    const worktreeRoot = join(parentRoot, "worktree");

    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "work"],
    });
    const targetSha = await commitRepoFile({
      repoRoot: worktreeRoot,
      filePath: "work.txt",
      content: "work\n",
      message: "work",
    });
    await appendRepoFile({
      repoRoot: worktreeRoot,
      filePath: "work.txt",
      content: "dirty\n",
    });

    await moveGitBranch({
      repoRoot,
      branch: "main",
      oldSha: sourceSha,
      newSha: targetSha,
      sourcePath: repoRoot,
      targetPath: worktreeRoot,
    });

    assert.equal(
      await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }),
      "",
    );
    assert.equal(
      await runGit({ cwd: worktreeRoot, args: ["branch", "--show-current"] }),
      "main",
    );
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), sourceSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), targetSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "work" }), targetSha);
    assert.equal(
      await readRepoFile({ repoRoot, filePath: "main.txt" }),
      "main\ndirty\n",
    );
    assert.equal(
      await readRepoFile({ repoRoot: worktreeRoot, filePath: "work.txt" }),
      "work\ndirty\n",
    );
  });
});

test("rejects moving a branch checked out in another worktree", async () => {
  await withOriginRepo(async ({ parentRoot, repoRoot }) => {
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
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "target"] });
    const targetSha = await commitRepoFile({
      repoRoot,
      filePath: "file.txt",
      content: "base\ntarget\n",
      message: "target",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });
    const worktreeRoot = join(parentRoot, "topic-worktree");
    await runGit({
      cwd: repoRoot,
      args: ["worktree", "add", worktreeRoot, "topic"],
    });

    await assert.rejects(async () => {
      await moveGitBranch({
        repoRoot,
        branch: "topic",
        oldSha: topicSha,
        newSha: targetSha,
        sourcePath: null,
        targetPath: null,
      });
    }, /checked out in a worktree/);
  });
});

test("moves the current branch with dirty changes by detaching HEAD", async () => {
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

    await moveGitBranch({
      repoRoot,
      branch: "main",
      oldSha,
      newSha: targetSha,
      sourcePath: repoRoot,
      targetPath: null,
    });

    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), targetSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), oldSha);
    assert.equal(
      await readRepoFile({ repoRoot, filePath: "file.txt" }),
      "base\ndirty\n",
    );
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

// -------------------------- GitHub pull requests ---------------

test("rejects pull requests when the head branch is not pushed", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const featureSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });

    await assert.rejects(async () => {
      await createGitPullRequest({
        repoRoot,
        baseBranch: "main",
        headBranch: "feature",
        headSha: featureSha,
        title: "Feature",
        description: "",
      });
    }, /Head branch must exist on origin/);
  });
});

test("rejects pull requests when the pushed head branch moved", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });
    await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\nnew\n",
      message: "feature new",
    });
    await runGit({ cwd: repoRoot, args: ["push", "origin", "feature"] });

    await assert.rejects(async () => {
      await createGitPullRequest({
        repoRoot,
        baseBranch: "main",
        headBranch: "feature",
        headSha: oldSha,
        title: "Feature",
        description: "",
      });
    }, /feature moved/);
  });
});

test("rejects pull requests when the base branch is not pushed", async () => {
  await withOriginRepo(async ({ repoRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const featureSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["push", "-u", "origin", "feature"] });

    await assert.rejects(async () => {
      await createGitPullRequest({
        repoRoot,
        baseBranch: "missing",
        headBranch: "feature",
        headSha: featureSha,
        title: "Feature",
        description: "",
      });
    }, /Base branch must exist on origin/);
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
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "main.txt",
      content: "main\n",
      message: "main",
    });

    const preview = await previewGitMerge({ repoRoot, branch: "feature" });

    assert.equal(preview.added, 1);
    assert.equal(preview.removed, 0);
    assert.equal(preview.conflictCount, 0);

    const branchTagChange = await mergeGitBranch({
      repoRoot,
      branch: "feature",
    });
    const newSha = await readSha({ cwd: repoRoot, ref: "HEAD" });

    assert.deepEqual(branchTagChange, {
      repoRoot,
      branch: "main",
      oldSha,
      newSha,
    });

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

test("returns the current branch tag change for fast-forward merges", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
      repoRoot,
      filePath: "base.txt",
      content: "base\n",
      message: "base",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const newSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });
    await runGit({ cwd: repoRoot, args: ["switch", "main"] });

    const branchTagChange = await mergeGitBranch({
      repoRoot,
      branch: "feature",
    });

    assert.deepEqual(branchTagChange, {
      repoRoot,
      branch: "main",
      oldSha,
      newSha,
    });
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), newSha);
    assert.equal(await readSha({ cwd: repoRoot, ref: "main" }), newSha);
  });
});

test("rejects merge when the branch is already in HEAD", async () => {
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
    await runGit({ cwd: repoRoot, args: ["merge", "--no-edit", "feature"] });

    await assert.rejects(async () => {
      await previewGitMerge({ repoRoot, branch: "feature" });
    }, /already in HEAD/);
    await assert.rejects(async () => {
      await mergeGitBranch({ repoRoot, branch: "feature" });
    }, /already in HEAD/);
  });
});

test("rejects merge when HEAD is detached", async () => {
  await withRepo(async ({ repoRoot }) => {
    const oldSha = await commitRepoFile({
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
    await runGit({ cwd: repoRoot, args: ["switch", "--detach", oldSha] });

    await assert.rejects(async () => {
      await previewGitMerge({ repoRoot, branch: "feature" });
    }, /HEAD must be on a branch/);
    await assert.rejects(async () => {
      await mergeGitBranch({ repoRoot, branch: "feature" });
    }, /HEAD must be on a branch/);
    assert.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), oldSha);
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

// -------------------------- Origin ref sync changes ---------------

test("pushes a safe branch sync update to origin", async () => {
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

    await pushGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha: newSha,
        originSha: oldSha,
      },
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

test("pushes a local-only branch sync change to origin", async () => {
  await withOriginRepo(async ({ repoRoot, originRoot }) => {
    await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
    const localSha = await commitRepoFile({
      repoRoot,
      filePath: "feature.txt",
      content: "feature\n",
      message: "feature",
    });

    await pushGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha,
        originSha: null,
      },
    ]);

    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/heads/feature" }),
      localSha,
    );
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/remotes/origin/feature" }),
      localSha,
    );
  });
});

test("pushes an origin-only branch sync change by deleting it from origin", async () => {
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

    await pushGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha: null,
        originSha: oldSha,
      },
    ]);

    assert.equal(
      await readOptionalSha({ cwd: originRoot, ref: "refs/heads/feature" }),
      null,
    );
    assert.equal(
      await readOptionalSha({
        cwd: repoRoot,
        ref: "refs/remotes/origin/feature",
      }),
      null,
    );
  });
});

test("pushes a local-only tag sync change to origin", async () => {
  await withOriginRepo(async ({ repoRoot, originRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "local-tag", mainSha] });
    const localSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/local-tag",
    });

    await pushGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "tag",
        name: "local-tag",
        localSha,
        originSha: null,
      },
    ]);

    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/tags/local-tag" }),
      localSha,
    );
  });
});

test("push fetches an origin-only tag locally instead of deleting it from origin", async () => {
  await withOriginRepo(async ({ repoRoot, originRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "remote-tag", mainSha] });
    const originSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/remote-tag",
    });
    await runGit({
      cwd: repoRoot,
      args: ["push", "origin", "refs/tags/remote-tag"],
    });
    await runGit({ cwd: repoRoot, args: ["tag", "-d", "remote-tag"] });

    await pushGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "tag",
        name: "remote-tag",
        localSha: null,
        originSha,
      },
    ]);

    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/tags/remote-tag" }),
      originSha,
    );
    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/tags/remote-tag" }),
      originSha,
    );
  });
});

test("pushes a branch sync update that would hide the old origin tip", async () => {
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

    await pushGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha: mainSha,
        originSha: oldSha,
      },
    ]);

    assert.equal(
      await readSha({ cwd: originRoot, ref: "refs/heads/feature" }),
      mainSha,
    );
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/remotes/origin/feature" }),
      mainSha,
    );
  });
});

test("rejects reverting a local branch when its local tip would disappear", async () => {
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
      await revertGitBranchSyncChanges([
        {
          repoRoot,
          gitRefType: "branch",
          name: "feature",
          localSha: newSha,
          originSha: oldSha,
        },
      ]);
    }, /hide commits/);

    assert.equal(await readSha({ cwd: repoRoot, ref: "feature" }), newSha);
  });
});

test("reverts a local branch when another ref keeps the local tip visible", async () => {
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

    await revertGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha: newSha,
        originSha: oldSha,
      },
    ]);

    assert.equal(await readSha({ cwd: repoRoot, ref: "feature" }), oldSha);
    assert.equal(
      await readSha({ cwd: repoRoot, ref: "keep-local-feature" }),
      newSha,
    );
  });
});

test("revert recreates an origin-only branch sync change locally", async () => {
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

    await revertGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "branch",
        name: "feature",
        localSha: null,
        originSha: oldSha,
      },
    ]);

    assert.equal(await readSha({ cwd: repoRoot, ref: "feature" }), oldSha);
  });
});

test("revert deletes a local-only branch when another ref keeps its tip visible", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["branch", "local-only", mainSha] });

    await revertGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "branch",
        name: "local-only",
        localSha: mainSha,
        originSha: null,
      },
    ]);

    assert.equal(
      await readOptionalSha({ cwd: repoRoot, ref: "local-only" }),
      null,
    );
  });
});

test("revert recreates an origin-only tag sync change locally", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "remote-tag", mainSha] });
    const originSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/remote-tag",
    });
    await runGit({
      cwd: repoRoot,
      args: ["push", "origin", "refs/tags/remote-tag"],
    });
    await runGit({ cwd: repoRoot, args: ["tag", "-d", "remote-tag"] });

    await revertGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "tag",
        name: "remote-tag",
        localSha: null,
        originSha,
      },
    ]);

    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/tags/remote-tag" }),
      originSha,
    );
  });
});

test("revert deletes a local-only tag when another ref keeps its tip visible", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "local-tag", mainSha] });
    const localSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/local-tag",
    });

    await revertGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "tag",
        name: "local-tag",
        localSha,
        originSha: null,
      },
    ]);

    assert.equal(
      await readOptionalSha({ cwd: repoRoot, ref: "refs/tags/local-tag" }),
      null,
    );
  });
});

test("revert resets a changed local tag to origin", async () => {
  await withOriginRepo(async ({ repoRoot, mainSha }) => {
    await runGit({ cwd: repoRoot, args: ["tag", "shared-tag", mainSha] });
    const originSha = await readSha({
      cwd: repoRoot,
      ref: "refs/tags/shared-tag",
    });
    await runGit({
      cwd: repoRoot,
      args: ["push", "origin", "refs/tags/shared-tag"],
    });
    const localSha = await commitRepoFile({
      repoRoot,
      filePath: "local-tag-target.txt",
      content: "local tag target\n",
      message: "local tag target",
    });
    await runGit({
      cwd: repoRoot,
      args: ["tag", "-f", "shared-tag", localSha],
    });
    await runGit({ cwd: repoRoot, args: ["tag", "keep-local-tag", localSha] });

    await revertGitBranchSyncChanges([
      {
        repoRoot,
        gitRefType: "tag",
        name: "shared-tag",
        localSha,
        originSha,
      },
    ]);

    assert.equal(
      await readSha({ cwd: repoRoot, ref: "refs/tags/shared-tag" }),
      originSha,
    );
  });
});
