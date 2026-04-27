"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetGitBranchTagChanges = exports.pushGitBranchTagChanges = exports.checkoutGitCommit = exports.moveGitBranch = exports.mergeGitBranch = exports.previewGitMerge = exports.deleteGitBranch = exports.createGitBranch = exports.commitAllGitChanges = exports.unstageGitChanges = exports.stageGitChanges = void 0;
const simple_git_1 = require("simple-git");
const FIELD_SEPARATOR = "\u001f";
// Git actions live here so IPC can stay focused on validating inputs before calling a small surface of mutations.
const runGitCommandForPath = async ({ path, args, }) => {
    await (0, simple_git_1.simpleGit)({ baseDir: path }).raw(args);
};
const readGitTextForPath = async ({ path, args, }) => {
    return (await (0, simple_git_1.simpleGit)({ baseDir: path }).raw(args)).trim();
};
// -------------------------- Worktree and visibility helpers ---------------
// Worktree state matters because a checked-out branch has to move through its own worktree.
const readGitWorktrees = async ({ repoRoot }) => {
    const text = await readGitTextForPath({
        path: repoRoot,
        args: ["worktree", "list", "--porcelain"],
    });
    const worktrees = [];
    const branchReferencePrefix = "refs/heads/";
    let path = null;
    let head = null;
    let branch = null;
    const pushWorktree = () => {
        if (path === null) {
            return;
        }
        worktrees.push({ path, head, branch });
    };
    for (const line of text.split("\n")) {
        if (line.length === 0) {
            pushWorktree();
            path = null;
            head = null;
            branch = null;
            continue;
        }
        const [key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        if (key === "worktree") {
            path = value;
            continue;
        }
        if (key === "HEAD") {
            head = value;
            continue;
        }
        if (key !== "branch") {
            continue;
        }
        if (value.startsWith(branchReferencePrefix)) {
            branch = value.slice(branchReferencePrefix.length);
            continue;
        }
        branch = value;
    }
    pushWorktree();
    return worktrees;
};
const readGitWorktreePathForBranch = async ({ repoRoot, branch, }) => {
    const worktrees = await readGitWorktrees({ repoRoot });
    for (const worktree of worktrees) {
        if (worktree.branch === branch) {
            return worktree.path;
        }
    }
    return null;
};
// Visibility checks answer whether an old commit will still appear in the graph after a ref changes.
const readIsShaReachableFromRootSha = async ({ repoRoot, sha, rootSha, }) => {
    if (sha === rootSha) {
        return true;
    }
    const ancestorPathText = await readGitTextForPath({
        path: repoRoot,
        args: [
            "rev-list",
            "--ancestry-path",
            "--max-count=1",
            `${sha}..${rootSha}`,
        ],
    });
    return ancestorPathText.length > 0;
};
const readVisibleRootShasAfterRefChange = async ({ repoRoot, changedRef, replacementSha, changedLocalBranch, rootRefs, shouldIncludeWorktreeHeads, }) => {
    const refText = await readGitTextForPath({
        path: repoRoot,
        args: [
            "for-each-ref",
            `--format=%(objectname)${FIELD_SEPARATOR}%(refname)`,
            ...rootRefs,
        ],
    });
    const rootShas = [];
    for (const line of refText.split("\n")) {
        if (line.length === 0) {
            continue;
        }
        const [sha, ref] = line.split(FIELD_SEPARATOR);
        if (sha === undefined || ref === undefined || ref === changedRef) {
            continue;
        }
        rootShas.push(sha);
    }
    if (replacementSha !== null) {
        rootShas.push(replacementSha);
    }
    if (shouldIncludeWorktreeHeads) {
        for (const worktree of await readGitWorktrees({ repoRoot })) {
            if (worktree.head === null || worktree.branch === changedLocalBranch) {
                continue;
            }
            rootShas.push(worktree.head);
        }
    }
    return rootShas;
};
// Every destructive ref change goes through this check before Git is allowed to move the ref.
const ensureOldShaStaysVisibleAfterRefChange = async ({ repoRoot, oldSha, changedRef, replacementSha, changedLocalBranch, rootRefs, shouldIncludeWorktreeHeads, message, }) => {
    const rootShas = await readVisibleRootShasAfterRefChange({
        repoRoot,
        changedRef,
        replacementSha,
        changedLocalBranch,
        rootRefs,
        shouldIncludeWorktreeHeads,
    });
    for (const rootSha of rootShas) {
        if (await readIsShaReachableFromRootSha({
            repoRoot,
            sha: oldSha,
            rootSha,
        })) {
            return;
        }
    }
    throw new Error(message);
};
// -------------------------- Local working tree actions ---------------
const stageGitChanges = async (path) => {
    await runGitCommandForPath({ path, args: ["add", "--all", "--", "."] });
};
exports.stageGitChanges = stageGitChanges;
const unstageGitChanges = async (path) => {
    await runGitCommandForPath({
        path,
        args: ["restore", "--staged", "--", "."],
    });
};
exports.unstageGitChanges = unstageGitChanges;
const commitAllGitChanges = async ({ path, message, }) => {
    const repoRoot = await readGitTextForPath({
        path,
        args: ["rev-parse", "--show-toplevel"],
    });
    const oldSha = await readGitTextForPath({
        path,
        args: ["rev-parse", "HEAD"],
    });
    const localBranchText = await readGitTextForPath({
        path,
        args: [
            "for-each-ref",
            "--points-at",
            oldSha,
            "--format=%(refname:short)",
            "refs/heads",
        ],
    });
    const branchesToMove = localBranchText
        .split("\n")
        .filter((branch) => branch.length > 0);
    await (0, exports.stageGitChanges)(path);
    await runGitCommandForPath({ path, args: ["commit", "-m", message] });
    const newSha = await readGitTextForPath({
        path,
        args: ["rev-parse", "HEAD"],
    });
    for (const branch of branchesToMove) {
        const branchRef = `refs/heads/${branch}`;
        const branchHead = await readGitTextForPath({
            path,
            args: ["rev-parse", "--verify", branchRef],
        });
        if (branchHead === newSha) {
            continue;
        }
        if (branchHead !== oldSha) {
            throw new Error(`${branch} moved. Refresh and try again.`);
        }
        const worktreePath = await readGitWorktreePathForBranch({
            repoRoot,
            branch,
        });
        if (worktreePath !== null) {
            continue;
        }
        await runGitCommandForPath({
            path,
            args: [
                "update-ref",
                "-m",
                `MoltTree: move ${branch}`,
                branchRef,
                newSha,
                oldSha,
            ],
        });
    }
    return newSha;
};
exports.commitAllGitChanges = commitAllGitChanges;
const createGitBranch = async ({ path, branch, }) => {
    await runGitCommandForPath({
        path,
        args: ["check-ref-format", "--branch", branch],
    });
    await runGitCommandForPath({ path, args: ["branch", branch] });
};
exports.createGitBranch = createGitBranch;
// Branch deletion needs an old sha because deleting a stale branch can hide commits the user did not mean to touch.
const deleteGitBranch = async ({ repoRoot, branch, oldSha, }) => {
    await runGitCommandForPath({
        path: repoRoot,
        args: ["check-ref-format", "--branch", branch],
    });
    const branchRef = `refs/heads/${branch}`;
    const expectedOldSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `${oldSha}^{commit}`],
    });
    const branchHead = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", branchRef],
    });
    if (branchHead !== expectedOldSha) {
        throw new Error(`${branch} moved. Refresh and try again.`);
    }
    const worktreePath = await readGitWorktreePathForBranch({
        repoRoot,
        branch,
    });
    if (worktreePath !== null) {
        throw new Error("Cannot delete a branch that is checked out.");
    }
    await ensureOldShaStaysVisibleAfterRefChange({
        repoRoot,
        oldSha: expectedOldSha,
        changedRef: branchRef,
        replacementSha: null,
        changedLocalBranch: branch,
        rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
        shouldIncludeWorktreeHeads: true,
        message: "Deleting this branch would hide commits from the graph. Move or tag another branch first.",
    });
    await runGitCommandForPath({
        path: repoRoot,
        args: ["branch", "-D", branch],
    });
};
exports.deleteGitBranch = deleteGitBranch;
const parseGitChangeLineCounts = (stdout) => {
    const lineCounts = {
        added: 0,
        removed: 0,
    };
    for (const line of stdout.split("\n")) {
        if (line.length === 0) {
            continue;
        }
        const [addedText, removedText] = line.split("\t");
        const added = Number(addedText);
        const removed = Number(removedText);
        if (Number.isFinite(added)) {
            lineCounts.added += added;
        }
        if (Number.isFinite(removed)) {
            lineCounts.removed += removed;
        }
    }
    return lineCounts;
};
// -------------------------- Merge actions ---------------
const readGitMergeBranchRef = async ({ repoRoot, branch, }) => {
    await runGitCommandForPath({
        path: repoRoot,
        args: ["check-ref-format", "--branch", branch],
    });
    const branchRef = `refs/heads/${branch}`;
    await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `${branchRef}^{commit}`],
    });
    return branchRef;
};
const previewGitMerge = async (gitMergeBranchRequest) => {
    const branchRef = await readGitMergeBranchRef(gitMergeBranchRequest);
    const diffText = await readGitTextForPath({
        path: gitMergeBranchRequest.repoRoot,
        args: ["diff", "--numstat", `HEAD...${branchRef}`, "--", "."],
    });
    const lineCounts = parseGitChangeLineCounts(diffText);
    const mergeTreeText = await readGitTextForPath({
        path: gitMergeBranchRequest.repoRoot,
        args: [
            "merge-tree",
            "--write-tree",
            "--name-only",
            "--no-messages",
            "HEAD",
            branchRef,
        ],
    });
    const mergeTreeLines = mergeTreeText
        .split("\n")
        .filter((line) => line.length > 0);
    const conflictCount = Math.max(0, mergeTreeLines.length - 1);
    const gitMergePreview = {
        added: lineCounts.added,
        removed: lineCounts.removed,
        conflictCount,
    };
    return gitMergePreview;
};
exports.previewGitMerge = previewGitMerge;
const mergeGitBranch = async (gitMergeBranchRequest) => {
    const branchRef = await readGitMergeBranchRef(gitMergeBranchRequest);
    const statusText = await readGitTextForPath({
        path: gitMergeBranchRequest.repoRoot,
        args: ["status", "--porcelain"],
    });
    if (statusText.length > 0) {
        throw new Error("Working tree must be clean before starting a merge.");
    }
    await runGitCommandForPath({
        path: gitMergeBranchRequest.repoRoot,
        args: ["merge", "--no-edit", branchRef],
    });
};
exports.mergeGitBranch = mergeGitBranch;
// -------------------------- Branch pointer and checkout actions ---------------
const moveGitBranch = async ({ repoRoot, branch, oldSha, newSha, }) => {
    await runGitCommandForPath({
        path: repoRoot,
        args: ["check-ref-format", "--branch", branch],
    });
    const branchRef = `refs/heads/${branch}`;
    const branchHead = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", branchRef],
    });
    const expectedOldSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `${oldSha}^{commit}`],
    });
    const targetSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `${newSha}^{commit}`],
    });
    if (branchHead === targetSha) {
        return;
    }
    if (branchHead !== expectedOldSha) {
        throw new Error("Branch moved. Refresh and try again.");
    }
    await ensureOldShaStaysVisibleAfterRefChange({
        repoRoot,
        oldSha: expectedOldSha,
        changedRef: branchRef,
        replacementSha: targetSha,
        changedLocalBranch: branch,
        rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
        shouldIncludeWorktreeHeads: true,
        message: "Moving this branch would hide commits from the graph. Move or tag another branch first.",
    });
    const worktreePath = await readGitWorktreePathForBranch({
        repoRoot,
        branch,
    });
    if (worktreePath === null) {
        await runGitCommandForPath({
            path: repoRoot,
            args: [
                "update-ref",
                "-m",
                `MoltTree: move ${branch}`,
                branchRef,
                targetSha,
                expectedOldSha,
            ],
        });
        return;
    }
    const statusText = await readGitTextForPath({
        path: worktreePath,
        args: ["status", "--porcelain"],
    });
    if (statusText.length > 0) {
        throw new Error("Working tree must be clean before moving this branch.");
    }
    const worktreeHead = await readGitTextForPath({
        path: worktreePath,
        args: ["rev-parse", "HEAD"],
    });
    if (worktreeHead !== expectedOldSha) {
        throw new Error("Branch moved. Refresh and try again.");
    }
    await runGitCommandForPath({
        path: worktreePath,
        args: ["reset", "--keep", targetSha],
    });
};
exports.moveGitBranch = moveGitBranch;
const checkoutGitCommit = async ({ repoRoot, sha, }) => {
    const targetSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "--verify", `${sha}^{commit}`],
    });
    const currentSha = await readGitTextForPath({
        path: repoRoot,
        args: ["rev-parse", "HEAD"],
    });
    if (currentSha === targetSha) {
        return;
    }
    const statusText = await readGitTextForPath({
        path: repoRoot,
        args: ["status", "--porcelain"],
    });
    if (statusText.length > 0) {
        throw new Error("Working tree must be clean before checking out a row.");
    }
    const visibleRefText = await readGitTextForPath({
        path: repoRoot,
        args: [
            "for-each-ref",
            "--contains",
            currentSha,
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    });
    if (visibleRefText.length === 0) {
        throw new Error("Current HEAD must be reachable from a branch or tag before switching rows.");
    }
    await runGitCommandForPath({
        path: repoRoot,
        args: ["switch", "--detach", targetSha],
    });
};
exports.checkoutGitCommit = checkoutGitCommit;
// -------------------------- Origin branch tag changes ---------------
const pushGitBranchTagChanges = async (gitBranchTagChanges) => {
    const pushedRepoRoots = [];
    for (const { repoRoot, branch, oldSha, newSha } of gitBranchTagChanges) {
        await runGitCommandForPath({
            path: repoRoot,
            args: ["check-ref-format", "--branch", branch],
        });
        const expectedOldSha = await readGitTextForPath({
            path: repoRoot,
            args: ["rev-parse", "--verify", `${oldSha}^{commit}`],
        });
        const remoteBranchRef = `refs/remotes/origin/${branch}`;
        const remoteHead = await readGitTextForPath({
            path: repoRoot,
            args: ["rev-parse", "--verify", remoteBranchRef],
        });
        if (remoteHead !== expectedOldSha) {
            throw new Error(`${branch} moved. Refresh and try again.`);
        }
        if (newSha === null) {
            let doesLocalBranchExist = false;
            try {
                await readGitTextForPath({
                    path: repoRoot,
                    args: ["rev-parse", "--verify", `refs/heads/${branch}`],
                });
                doesLocalBranchExist = true;
            }
            catch {
                doesLocalBranchExist = false;
            }
            if (doesLocalBranchExist) {
                throw new Error(`${branch} exists locally. Refresh and try again.`);
            }
            await ensureOldShaStaysVisibleAfterRefChange({
                repoRoot,
                oldSha: expectedOldSha,
                changedRef: remoteBranchRef,
                replacementSha: null,
                changedLocalBranch: null,
                rootRefs: ["refs/remotes/origin"],
                shouldIncludeWorktreeHeads: false,
                message: "Pushing this branch deletion would hide commits from the graph. Move or tag another branch first.",
            });
            await runGitCommandForPath({
                path: repoRoot,
                args: ["push", "origin", "--delete", branch],
            });
            if (!pushedRepoRoots.includes(repoRoot)) {
                pushedRepoRoots.push(repoRoot);
            }
            continue;
        }
        const branchRef = `refs/heads/${branch}`;
        const targetSha = await readGitTextForPath({
            path: repoRoot,
            args: ["rev-parse", "--verify", `${newSha}^{commit}`],
        });
        const branchHead = await readGitTextForPath({
            path: repoRoot,
            args: ["rev-parse", "--verify", branchRef],
        });
        if (branchHead !== targetSha) {
            throw new Error(`${branch} moved. Refresh and try again.`);
        }
        await ensureOldShaStaysVisibleAfterRefChange({
            repoRoot,
            oldSha: expectedOldSha,
            changedRef: remoteBranchRef,
            replacementSha: targetSha,
            changedLocalBranch: null,
            rootRefs: ["refs/remotes/origin"],
            shouldIncludeWorktreeHeads: false,
            message: "Pushing this branch update would hide commits from the graph. Move or tag another branch first.",
        });
        await runGitCommandForPath({
            path: repoRoot,
            args: [
                "push",
                "--force-with-lease",
                "origin",
                `${branchRef}:${branchRef}`,
            ],
        });
        if (!pushedRepoRoots.includes(repoRoot)) {
            pushedRepoRoots.push(repoRoot);
        }
    }
    for (const repoRoot of pushedRepoRoots) {
        await runGitCommandForPath({
            path: repoRoot,
            args: ["fetch", "origin", "--prune"],
        });
    }
};
exports.pushGitBranchTagChanges = pushGitBranchTagChanges;
const resetGitBranchTagChanges = async (gitBranchTagChanges) => {
    const fetchedRepoRoots = [];
    for (const { repoRoot } of gitBranchTagChanges) {
        if (fetchedRepoRoots.includes(repoRoot)) {
            continue;
        }
        await runGitCommandForPath({
            path: repoRoot,
            args: ["fetch", "origin", "--prune"],
        });
        fetchedRepoRoots.push(repoRoot);
    }
    for (const { repoRoot, branch } of gitBranchTagChanges) {
        await runGitCommandForPath({
            path: repoRoot,
            args: ["check-ref-format", "--branch", branch],
        });
        const branchRef = `refs/heads/${branch}`;
        const remoteSha = await readGitTextForPath({
            path: repoRoot,
            args: ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`],
        });
        let localSha = null;
        try {
            localSha = await readGitTextForPath({
                path: repoRoot,
                args: ["rev-parse", "--verify", branchRef],
            });
        }
        catch {
            localSha = null;
        }
        if (localSha === null) {
            await runGitCommandForPath({
                path: repoRoot,
                args: ["branch", branch, remoteSha],
            });
            continue;
        }
        await ensureOldShaStaysVisibleAfterRefChange({
            repoRoot,
            oldSha: localSha,
            changedRef: branchRef,
            replacementSha: remoteSha,
            changedLocalBranch: branch,
            rootRefs: ["refs/heads", "refs/remotes", "refs/tags"],
            shouldIncludeWorktreeHeads: true,
            message: "Resetting this branch would hide commits from the graph. Move or tag another branch first.",
        });
        const worktreePath = await readGitWorktreePathForBranch({
            repoRoot,
            branch,
        });
        if (worktreePath === null) {
            await runGitCommandForPath({
                path: repoRoot,
                args: [
                    "update-ref",
                    "-m",
                    `MoltTree: reset ${branch}`,
                    branchRef,
                    remoteSha,
                    localSha,
                ],
            });
            continue;
        }
        const statusText = await readGitTextForPath({
            path: worktreePath,
            args: ["status", "--porcelain"],
        });
        if (statusText.length > 0) {
            throw new Error(`Working tree must be clean before resetting ${branch}.`);
        }
        const worktreeHead = await readGitTextForPath({
            path: worktreePath,
            args: ["rev-parse", "HEAD"],
        });
        if (worktreeHead !== localSha) {
            throw new Error(`${branch} moved. Refresh and try again.`);
        }
        await runGitCommandForPath({
            path: worktreePath,
            args: ["reset", "--keep", remoteSha],
        });
    }
};
exports.resetGitBranchTagChanges = resetGitBranchTagChanges;
