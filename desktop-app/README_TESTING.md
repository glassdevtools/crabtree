# Git Testing Inventory

This file is the short checklist for Git behavior in MoltTree. Tests should prove each action works and that unsafe actions either warn first or cannot hide commits from the visible graph.

## Git State We Read

- Repos from Codex thread cwd values.
- Repo root, origin URL, current branch, and default branch.
- Linked worktrees, including path, HEAD sha, checked-out branch, detached state, and thread ids.
- Commit graph rows: commits, parents, refs, local branch tags, author/date/subject, and attached thread ids.
- Shallow or incomplete history warnings.
- Staged and unstaged line counts for repo cwd values and worktrees.
- Local branch tag changes compared with `origin`.

## Git Actions We Run

- Stage all changes in a path.
- Unstage all changes in a path.
- Commit all changes in a path.
- Move local branch tags that pointed at the old commit after committing.
- Create a branch at the current HEAD.
- Delete a local branch tag.
- Delete a normal Git tag.
- Drag a branch tag to another commit.
- Move a checked-out branch with `git reset --keep`.
- Switch HEAD to a commit with detached checkout.
- Preview merging a branch into HEAD.
- Merge a branch into HEAD.
- Create a GitHub pull request from a pushed branch.
- Push branch tag changes to origin.
- Push branch deletion to origin.
- Pull/reset local branch tags to match origin.
- Create missing local branches from origin during pull/reset.

## UI-Only Git Workflows

- Show or hide branch delete buttons.
- Show or hide merge buttons.
- Allow or block branch drag targets.
- Open create-branch flow for dirty cwd values with no known branch target.
- Open commit flow for dirty cwd values with a known branch target.
- Remember pending branch tag changes until push/pull/reset.
- Show staged and unstaged change summaries.
- Filter the graph to commits with chats.
- Open the GitHub pull request flow only for committed rows.

## Safety Rules To Test

- Never allow an action that makes commits disappear from the visible graph unless the confirmation explains the exact ref and commit that will disappear.
- Backend Git actions need their own checks for blocked safety rules.
- Reject stale `oldSha` requests.
- Reject checkout, merge, reset, and checked-out branch moves when the worktree is dirty.
- Reject pull requests when the selected head branch is not pushed or moved.
- Warn before deleting checked-out branches.
- Warn before deleting the only local branch/tag/worktree ref that keeps commits visible.
- Reject moving the only local branch/tag/worktree ref that keeps commits visible.
- Reject switching away from an unreachable detached HEAD.
- Warn before pushing remote updates that would hide commits from the visible graph.
- Reject reset/pull actions that would hide local-only commits unless another local ref keeps them visible.

## Minimum Test Coverage

- Read tests for repos, worktrees, commits, refs, warnings, change counts, and branch tag changes.
- Success tests for every action in **Git Actions We Run**.
- Failure tests for every rule in **Safety Rules To Test**.
- UI tests for hidden buttons, blocked drops, merge eligibility, and pending branch tag change consolidation.
