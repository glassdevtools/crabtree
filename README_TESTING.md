add a suite of tests for the git behavior in this repo

first, write down every git functionality we have - for example, drag branch to another commit to, delete branch, merge branch into HEAD, switch HEAD to a commit, etc

for each functionality ensure 
- it works
- safety: we must never allow operations that allow the user to change the tree of commits in such a way to lose data, even if it's recoverable. For example, deleting a branch tag that was the only thing holding a commit to be visible in the tree of commits is considered "unsafe" and we should disallow it (eg we do this currently, i think, by not showing trash icons on such branches).
- we currently do a lot of this, but i would like you to double check and look for places that might be missing. don't come up with false positives, ensure the things you say are actually valid.




# Git Testing Inventory

This file lists every Git behavior MoltTree currently has, so the test suite can cover both the happy path and the safety rules. The core rule is that no user action should make commits disappear from the visible commit graph by removing or moving the last visible ref that keeps those commits reachable.

## Read-Only Git Data

- **Discover repos from Codex thread cwd values**
  - Source: `src/main/gitData.ts`
  - Reads `rev-parse --show-toplevel`, `config --get remote.origin.url`, `branch --show-current`, and `origin/HEAD`.
  - Groups threads by origin URL when available, otherwise by repo root.

- **Read the default branch**
  - Source: `src/main/gitData.ts`
  - Reads `refs/remotes/origin/HEAD` and strips the `origin/` prefix.

- **Read linked worktrees**
  - Source: `src/main/gitData.ts`
  - Reads `git worktree list --porcelain`.
  - Tracks worktree path, HEAD sha, branch, detached state, and thread ids under that worktree.

- **Read commit graph rows**
  - Source: `src/main/gitData.ts`
  - Walks local branches, remote refs, tags, root HEAD, and worktree HEADs.
  - Reads commit sha, short sha, parent shas, refs, local branch tags, author, date, subject, and attached thread ids.
  - Paginates history in 1000-commit pages.

- **Read shallow or incomplete history warnings**
  - Source: `src/main/gitData.ts`
  - Warns when the repo is shallow.
  - Warns when parent commits referenced by visible commits are missing locally.

- **Read staged and unstaged line counts**
  - Source: `src/main/gitData.ts`
  - Reads `git diff --numstat -- .` and `git diff --cached --numstat -- .`.
  - Runs for thread cwd values and linked worktree paths.

- **Read local branch tag changes versus origin**
  - Source: `src/main/gitData.ts`
  - Compares `refs/heads` against `refs/remotes/origin`.
  - Produces `{ repoRoot, branch, oldSha, newSha }` changes for local branches that differ from origin.

## Local Git Mutations

- **Stage all changes in a repo path**
  - IPC: `git:stageChanges`
  - API: `stageGitChanges(path)`
  - Command: `git add --all -- .`

- **Unstage all changes in a repo path**
  - IPC: `git:unstageChanges`
  - API: `unstageGitChanges(path)`
  - Command: `git restore --staged -- .`

- **Commit all changes**
  - IPC: `git:commitAllChanges`
  - API: `commitAllGitChanges({ path, message })`
  - Stages all changes, commits with the provided message, and returns the new HEAD sha.
  - Moves local branch tags that pointed at the old HEAD to the new commit when those branches are not checked out in a linked worktree.
  - Uses `update-ref` with the old sha when moving branch tags after commit.
  - Safety tests should cover empty messages being rejected by request parsing, stale branch tags being rejected, and checked-out worktree branches not being moved by this helper.

- **Create branch**
  - IPC: `git:createBranch`
  - API: `createGitBranch({ path, branch })`
  - Validates the branch name with `git check-ref-format --branch`.
  - Creates the branch at the current HEAD for the provided path.

- **Delete local branch tag**
  - IPC: `git:deleteBranch`
  - API: `deleteGitBranch({ repoRoot, branch })`
  - Command: `git branch -D <branch>`.
  - Renderer safety gate: delete buttons are shown only for local branches that are not the current branch, not the default branch, not checked out in any worktree, and whose tip remains reachable from another local branch/tag/fixed ref after deletion.
  - Test safety requirement: the backend should also reject unsafe deletes, because IPC can be called without the renderer button.

## Branch Pointer And Checkout Behavior

- **Drag branch tag to another commit**
  - Renderer action: drag a local branch label onto another commit row.
  - IPC: `git:moveBranch`
  - API: `moveGitBranch({ repoRoot, branch, oldSha, newSha })`
  - Uses `update-ref` with the old sha when the branch is not checked out in a worktree.
  - Uses `git reset --keep <target>` in the branch worktree when the branch is checked out.
  - Rejects stale `oldSha`.
  - Rejects dirty worktrees before resetting a checked-out branch.
  - Safety gate: the old commit must stay visible from the new target, another local branch, a tag, `HEAD`, or a detached worktree.

- **Move branch pointer after committing thread changes**
  - Renderer action: commit dirty cwd changes for a thread whose branch tag is known.
  - Flow: `commitAllGitChanges` creates a commit, then `moveGitBranch` moves the selected branch to the new commit.
  - Records an in-memory branch tag change so push/pull/reset actions can present the pending change.

- **Switch HEAD to a commit**
  - IPC: `git:checkoutCommit`
  - API: `checkoutGitCommit({ repoRoot, sha })`
  - Verifies the target is a commit.
  - Rejects dirty working trees.
  - Rejects switching away from a detached HEAD that is not reachable from any branch, remote branch, or tag.
  - Uses `git switch --detach <target>`.

## Merge Behavior

- **Show merge button for eligible branch rows**
  - Renderer action: merge icon in the graph column.
  - Hidden for the current HEAD row, ancestors of HEAD, and when HEAD is dirty.
  - Uses the first local branch on an eligible commit that is not the current branch.

- **Preview branch merge into HEAD**
  - IPC: `git:previewMerge`
  - API: `previewGitMerge({ repoRoot, branch })`
  - Validates branch name and local branch ref.
  - Reads `git diff --numstat HEAD...<branch> -- .`.
  - Reads `git merge-tree --write-tree --name-only --no-messages HEAD <branch>`.
  - Returns added lines, removed lines, and conflict count.

- **Merge branch into HEAD**
  - IPC: `git:mergeBranch`
  - API: `mergeGitBranch({ repoRoot, branch })`
  - Validates branch name and local branch ref.
  - Rejects dirty working trees.
  - Runs `git merge --no-edit <branchRef>`.

## Branch Tag Sync With Origin

- **Remember local branch tag changes in memory**
  - Source: `src/renderer/App.tsx`
  - Combines dashboard-detected local-vs-origin differences with explicit local deletes and branch moves.
  - Drops a remembered change when the remembered old sha equals the new sha.

- **Push branch tag changes**
  - IPC: `git:pushBranchTagChanges`
  - API: `pushGitBranchTagChanges(changes)`
  - For branch updates, verifies the local branch still points at `newSha`.
  - Pushes with `git push --force-with-lease origin refs/heads/<branch>:refs/heads/<branch>`.
  - For branch deletes, rejects if the branch still exists locally.
  - Pushes delete with `git push origin --delete <branch>`.
  - Fetches with prune after successful pushes.
  - Test safety requirement: push update/delete should not hide commits from origin's visible branch graph.

- **Pull branch tag changes from origin**
  - UI action: Pull branch tag changes.
  - IPC/API path: currently uses `resetGitBranchTagChanges`.
  - Fetches origin with prune.
  - Creates a missing local branch at the origin sha.
  - Force-moves a non-checked-out local branch to the origin sha.
  - Resets a checked-out branch worktree with `git reset --keep <remoteSha>` after checking for a clean worktree and stale branch state.

- **Reset branch tag changes to origin**
  - UI action: Reset branch tag changes.
  - IPC/API path: currently also uses `resetGitBranchTagChanges`.
  - Same behavior as pull today.
  - Test safety requirement: reset should not hide local-only commits unless another local branch, tag, HEAD, or detached worktree keeps them visible.

## Renderer-Only Git Workflows

- **Create branch for dirty cwd with no branch target**
  - Shown when a thread cwd has changes but no clear local branch target.
  - Opens the create branch modal and calls `createGitBranch`.

- **Commit changes for dirty cwd with a branch target**
  - Shown when a thread cwd has changes and a local branch target can be inferred.
  - Opens the commit modal, calls `commitAllGitChanges`, then may call `moveGitBranch`.

- **Show change summary**
  - Shows staged and unstaged added/removed line counts for a thread cwd.
  - Can open the cwd in VS Code, but that is not a Git mutation.

- **Filter graph to rows with chats**
  - UI-only filtering of commit rows.
  - Does not change Git state.

## Test Coverage Checklist

Every Git test suite should include these categories:

- Read graph tests for repo discovery, default branch, worktrees, commits, refs, thread ids, shallow warnings, and missing parent warnings.
- Change summary tests for staged, unstaged, clean, duplicate cwd, non-Git cwd, and worktree cwd cases.
- Branch tag change detection tests for no origin, equal local/remote, local ahead, local behind, local branch missing from origin, and origin/HEAD being ignored.
- Mutation success tests for stage, unstage, commit, create branch, delete safe branch, move safe branch, checkout safe commit, preview merge, merge, push update, push delete, pull/reset create local branch, pull/reset move local branch, and pull/reset checked-out branch.
- Mutation safety tests for dirty worktrees, stale shas, invalid branch names, checked-out branch deletion, unsafe local branch deletion, unsafe branch move, unsafe checkout from unreachable detached HEAD, unsafe push update/delete, unsafe reset, and merge conflicts.
- UI safety tests for hidden delete buttons, hidden merge buttons, blocked branch drop targets, branch move confirmation text, and pending branch tag change consolidation.
