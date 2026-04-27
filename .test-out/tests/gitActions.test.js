"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const node_util_1 = require("node:util");
const gitActions_1 = require("../src/main/gitActions");
const gitData_1 = require("../src/main/gitData");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const runGit = async ({ cwd, args }) => {
    const { stdout } = await execFileAsync("git", args, {
        cwd,
        encoding: "utf8",
    });
    return stdout.trim();
};
const writeRepoFile = async ({ repoRoot, filePath, content, }) => {
    const absolutePath = (0, node_path_1.join)(repoRoot, filePath);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(absolutePath), { recursive: true });
    await (0, promises_1.writeFile)(absolutePath, content);
};
const appendRepoFile = async ({ repoRoot, filePath, content, }) => {
    const absolutePath = (0, node_path_1.join)(repoRoot, filePath);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(absolutePath), { recursive: true });
    await (0, promises_1.appendFile)(absolutePath, content);
};
const readRepoFile = async ({ repoRoot, filePath, }) => {
    return await (0, promises_1.readFile)((0, node_path_1.join)(repoRoot, filePath), "utf8");
};
const readSha = async ({ cwd, ref }) => {
    return await runGit({ cwd, args: ["rev-parse", "--verify", ref] });
};
const readOptionalSha = async ({ cwd, ref }) => {
    try {
        return await readSha({ cwd, ref });
    }
    catch {
        return null;
    }
};
const commitRepoFile = async ({ repoRoot, filePath, content, message, }) => {
    await writeRepoFile({ repoRoot, filePath, content });
    await runGit({ cwd: repoRoot, args: ["add", "--", filePath] });
    await runGit({ cwd: repoRoot, args: ["commit", "-m", message] });
    return await readSha({ cwd: repoRoot, ref: "HEAD" });
};
const createRepo = async () => {
    const repoRoot = await (0, promises_1.realpath)(await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "molttree-git-")));
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
const withRepo = async (runTest) => {
    const repo = await createRepo();
    try {
        await runTest(repo);
    }
    finally {
        await (0, promises_1.rm)(repo.repoRoot, { recursive: true, force: true });
    }
};
const createRepoWithOrigin = async () => {
    const parentRoot = await (0, promises_1.realpath)(await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "molttree-git-origin-")));
    const originRoot = (0, node_path_1.join)(parentRoot, "origin.git");
    const repoRoot = (0, node_path_1.join)(parentRoot, "repo");
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
const withOriginRepo = async (runTest) => {
    const repo = await createRepoWithOrigin();
    try {
        await runTest(repo);
    }
    finally {
        await (0, promises_1.rm)(repo.parentRoot, { recursive: true, force: true });
    }
};
const createThread = ({ id, cwd }) => {
    const thread = {
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
(0, node_test_1.default)("reads repo graphs with commits, worktrees, and branch tag changes", async () => {
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
        const worktreeRoot = (0, node_path_1.join)(parentRoot, "feature-worktree");
        await runGit({
            cwd: repoRoot,
            args: ["worktree", "add", worktreeRoot, "feature"],
        });
        const threads = [
            createThread({ id: "root-thread", cwd: repoRoot }),
            createThread({ id: "worktree-thread", cwd: worktreeRoot }),
        ];
        const { repos, warnings, gitErrors } = await (0, gitData_1.readRepoGraphs)({ threads });
        const repo = repos[0];
        strict_1.default.equal(warnings.length, 0);
        strict_1.default.equal(gitErrors.length, 0);
        strict_1.default.equal(repos.length, 1);
        strict_1.default.equal(repo?.root, repoRoot);
        strict_1.default.equal(repo?.currentBranch, "main");
        strict_1.default.equal(repo?.defaultBranch, "main");
        strict_1.default.deepEqual(repo?.threadIds.sort(), [
            "root-thread",
            "worktree-thread",
        ]);
        strict_1.default.deepEqual(repo?.branchTagChanges, [
            { repoRoot, branch: "feature", oldSha, newSha },
        ]);
        strict_1.default.equal(repo?.worktrees.length, 1);
        strict_1.default.equal(repo?.worktrees[0]?.path, worktreeRoot);
        strict_1.default.equal(repo?.worktrees[0]?.branch, "feature");
        strict_1.default.equal(repo?.worktrees[0]?.head, newSha);
        const featureCommit = repo?.commits.find((commit) => commit.sha === newSha);
        strict_1.default.notEqual(featureCommit, undefined);
        strict_1.default.equal(featureCommit?.localBranches.includes("feature"), true);
        strict_1.default.deepEqual(featureCommit?.threadIds, ["worktree-thread"]);
    });
});
(0, node_test_1.default)("reads staged and unstaged change summaries for repo and worktree cwd values", async () => {
    await withOriginRepo(async ({ parentRoot, repoRoot }) => {
        await runGit({ cwd: repoRoot, args: ["switch", "-c", "feature"] });
        await commitRepoFile({
            repoRoot,
            filePath: "feature.txt",
            content: "feature\n",
            message: "feature",
        });
        await runGit({ cwd: repoRoot, args: ["switch", "main"] });
        const worktreeRoot = (0, node_path_1.join)(parentRoot, "feature-worktree");
        await runGit({
            cwd: repoRoot,
            args: ["worktree", "add", worktreeRoot, "feature"],
        });
        const threads = [
            createThread({ id: "root-thread", cwd: repoRoot }),
            createThread({ id: "worktree-thread", cwd: worktreeRoot }),
        ];
        const repoGraphResult = await (0, gitData_1.readRepoGraphs)({ threads });
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
        const { gitChangesOfCwd, gitErrors } = await (0, gitData_1.readGitChangesOfCwd)({
            threads,
            repos: repoGraphResult.repos,
        });
        strict_1.default.equal(gitErrors.length, 0);
        strict_1.default.equal(gitChangesOfCwd[repoRoot]?.staged.added, 1);
        strict_1.default.equal(gitChangesOfCwd[repoRoot]?.unstaged.added, 0);
        strict_1.default.equal(gitChangesOfCwd[worktreeRoot]?.staged.added, 0);
        strict_1.default.equal(gitChangesOfCwd[worktreeRoot]?.unstaged.added, 1);
    });
});
// -------------------------- Local working tree actions ---------------
(0, node_test_1.default)("stages and unstages all changes in a repo path", async () => {
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
        await (0, gitActions_1.stageGitChanges)(repoRoot);
        strict_1.default.equal(await runGit({
            cwd: repoRoot,
            args: ["diff", "--cached", "--name-only"],
        }), "file.txt");
        await (0, gitActions_1.unstageGitChanges)(repoRoot);
        strict_1.default.equal(await runGit({
            cwd: repoRoot,
            args: ["diff", "--cached", "--name-only"],
        }), "");
        strict_1.default.equal(await runGit({ cwd: repoRoot, args: ["diff", "--name-only"] }), "file.txt");
    });
});
(0, node_test_1.default)("commits all changes and advances colocated local branch tags", async () => {
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
        const newSha = await (0, gitActions_1.commitAllGitChanges)({
            path: repoRoot,
            message: "second",
        });
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), newSha);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "refs/heads/topic" }), newSha);
        strict_1.default.equal(await runGit({ cwd: repoRoot, args: ["rev-parse", `${newSha}^`] }), oldSha);
    });
});
(0, node_test_1.default)("creates a branch at the current HEAD", async () => {
    await withRepo(async ({ repoRoot }) => {
        const headSha = await commitRepoFile({
            repoRoot,
            filePath: "file.txt",
            content: "one\n",
            message: "initial",
        });
        await (0, gitActions_1.createGitBranch)({ path: repoRoot, branch: "created" });
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "refs/heads/created" }), headSha);
    });
});
// -------------------------- Branch tag deletion ---------------
(0, node_test_1.default)("deletes a branch when another ref keeps its tip visible", async () => {
    await withRepo(async ({ repoRoot }) => {
        const oldSha = await commitRepoFile({
            repoRoot,
            filePath: "file.txt",
            content: "one\n",
            message: "initial",
        });
        await runGit({ cwd: repoRoot, args: ["branch", "keep", oldSha] });
        await runGit({ cwd: repoRoot, args: ["branch", "delete-me", oldSha] });
        await (0, gitActions_1.deleteGitBranch)({
            repoRoot,
            branch: "delete-me",
            oldSha,
        });
        strict_1.default.equal(await readOptionalSha({ cwd: repoRoot, ref: "delete-me" }), null);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "keep" }), oldSha);
    });
});
(0, node_test_1.default)("rejects deleting the only ref that keeps a commit visible", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.deleteGitBranch)({
                repoRoot,
                branch: "topic",
                oldSha: topicSha,
            });
        }, /hide commits/);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "topic" }), topicSha);
    });
});
(0, node_test_1.default)("rejects deleting a branch when the old sha is stale", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.deleteGitBranch)({
                repoRoot,
                branch: "topic",
                oldSha,
            });
        }, /moved/);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "topic" }), topicSha);
    });
});
// -------------------------- Branch pointer moves ---------------
(0, node_test_1.default)("moves a branch to a descendant commit", async () => {
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
        await (0, gitActions_1.moveGitBranch)({
            repoRoot,
            branch: "topic",
            oldSha,
            newSha,
        });
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "topic" }), newSha);
    });
});
(0, node_test_1.default)("rejects moving a branch when its old tip would disappear from the graph", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.moveGitBranch)({
                repoRoot,
                branch: "topic",
                oldSha: topicSha,
                newSha: baseSha,
            });
        }, /hide commits/);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "topic" }), topicSha);
    });
});
(0, node_test_1.default)("resets a checked-out branch to a safe target commit", async () => {
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
        await (0, gitActions_1.moveGitBranch)({
            repoRoot,
            branch: "main",
            oldSha,
            newSha: targetSha,
        });
        strict_1.default.equal(await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }), "main");
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), targetSha);
        strict_1.default.equal(await readRepoFile({ repoRoot, filePath: "file.txt" }), "base\ntarget\n");
    });
});
(0, node_test_1.default)("rejects moving a checked-out branch with a dirty working tree", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.moveGitBranch)({
                repoRoot,
                branch: "main",
                oldSha,
                newSha: targetSha,
            });
        }, /clean/);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "main" }), oldSha);
    });
});
// -------------------------- Checkout and merge ---------------
(0, node_test_1.default)("switches HEAD to a commit only when the current HEAD remains visible", async () => {
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
        await (0, gitActions_1.checkoutGitCommit)({ repoRoot, sha: firstSha });
        strict_1.default.equal(await runGit({ cwd: repoRoot, args: ["branch", "--show-current"] }), "");
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), firstSha);
        const detachedSha = await commitRepoFile({
            repoRoot,
            filePath: "detached.txt",
            content: "detached\n",
            message: "detached",
        });
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.checkoutGitCommit)({ repoRoot, sha: secondSha });
        }, /reachable/);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "HEAD" }), detachedSha);
    });
});
(0, node_test_1.default)("rejects checkout when the working tree is dirty", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.checkoutGitCommit)({ repoRoot, sha: firstSha });
        }, /clean/);
    });
});
(0, node_test_1.default)("previews and merges a branch into HEAD", async () => {
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
        const preview = await (0, gitActions_1.previewGitMerge)({ repoRoot, branch: "feature" });
        strict_1.default.equal(preview.added, 1);
        strict_1.default.equal(preview.removed, 0);
        strict_1.default.equal(preview.conflictCount, 0);
        await (0, gitActions_1.mergeGitBranch)({ repoRoot, branch: "feature" });
        strict_1.default.equal(await runGit({
            cwd: repoRoot,
            args: ["rev-list", "--parents", "-n", "1", "HEAD"],
        }).then((line) => line.split(" ").length), 3);
        strict_1.default.equal(await readRepoFile({ repoRoot, filePath: "feature.txt" }), "feature\n");
    });
});
(0, node_test_1.default)("rejects merge when the working tree is dirty", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.mergeGitBranch)({ repoRoot, branch: "feature" });
        }, /clean/);
    });
});
// -------------------------- Origin branch tag changes ---------------
(0, node_test_1.default)("pushes a safe branch tag update to origin", async () => {
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
        await (0, gitActions_1.pushGitBranchTagChanges)([
            { repoRoot, branch: "feature", oldSha, newSha },
        ]);
        strict_1.default.equal(await readSha({ cwd: originRoot, ref: "refs/heads/feature" }), newSha);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "refs/remotes/origin/feature" }), newSha);
    });
});
(0, node_test_1.default)("rejects pushing a branch tag update that would hide the old origin tip", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.pushGitBranchTagChanges)([
                { repoRoot, branch: "feature", oldSha, newSha: mainSha },
            ]);
        }, /hide commits/);
        strict_1.default.equal(await readSha({ cwd: originRoot, ref: "refs/heads/feature" }), oldSha);
    });
});
(0, node_test_1.default)("rejects pushing an unsafe origin branch deletion", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.pushGitBranchTagChanges)([
                { repoRoot, branch: "feature", oldSha, newSha: null },
            ]);
        }, /hide commits/);
        strict_1.default.equal(await readSha({ cwd: originRoot, ref: "refs/heads/feature" }), oldSha);
    });
});
(0, node_test_1.default)("pushes an origin branch deletion when another origin ref keeps the old tip visible", async () => {
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
        await (0, gitActions_1.pushGitBranchTagChanges)([
            { repoRoot, branch: "feature", oldSha, newSha: null },
        ]);
        strict_1.default.equal(await readOptionalSha({ cwd: originRoot, ref: "refs/heads/feature" }), null);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "keep-feature" }), oldSha);
        strict_1.default.equal(await readSha({ cwd: originRoot, ref: "refs/heads/keep-feature" }), oldSha);
    });
});
(0, node_test_1.default)("rejects resetting a local branch when its local tip would disappear", async () => {
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
        await strict_1.default.rejects(async () => {
            await (0, gitActions_1.resetGitBranchTagChanges)([
                { repoRoot, branch: "feature", oldSha, newSha },
            ]);
        }, /hide commits/);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "feature" }), newSha);
    });
});
(0, node_test_1.default)("resets a local branch when another ref keeps the local tip visible", async () => {
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
        await (0, gitActions_1.resetGitBranchTagChanges)([
            { repoRoot, branch: "feature", oldSha, newSha },
        ]);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "feature" }), oldSha);
        strict_1.default.equal(await readSha({ cwd: repoRoot, ref: "keep-local-feature" }), newSha);
    });
});
