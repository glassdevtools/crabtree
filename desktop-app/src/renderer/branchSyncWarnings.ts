import type {
  GitBranchSyncChange,
  GitCommit,
  GitWorktree,
} from "../shared/types";

const cleanRefName = (ref: string) => {
  const headPrefix = "HEAD -> ";
  const originHeadPrefix = "origin/HEAD -> ";
  const tagPrefix = "tag: ";

  if (ref.startsWith(headPrefix)) {
    return ref.slice(headPrefix.length);
  }

  if (ref.startsWith(originHeadPrefix)) {
    return "origin/HEAD";
  }

  if (ref.startsWith(tagPrefix)) {
    return ref.slice(tagPrefix.length);
  }

  return ref;
};

// Push warnings mirror the visible graph so the user sees the risk before choosing to push.
export const readBranchSyncPushWarningMessages = ({
  branchSyncChanges,
  commits,
  worktrees,
}: {
  branchSyncChanges: GitBranchSyncChange[];
  commits: GitCommit[];
  worktrees: GitWorktree[];
}) => {
  const commitOfSha: { [sha: string]: GitCommit } = {};
  const warningMessages: string[] = [];

  for (const commit of commits) {
    commitOfSha[commit.sha] = commit;
  }

  const readIsAncestorInGraph = ({
    ancestorSha,
    descendantSha,
  }: {
    ancestorSha: string;
    descendantSha: string;
  }) => {
    const shasToRead = [descendantSha];
    const isReadSha: { [sha: string]: boolean } = {};

    while (shasToRead.length > 0) {
      const sha = shasToRead.pop();

      if (sha === undefined || isReadSha[sha] === true) {
        continue;
      }

      if (sha === ancestorSha) {
        return true;
      }

      isReadSha[sha] = true;
      const commit = commitOfSha[sha];

      if (commit === undefined) {
        continue;
      }

      for (const parent of commit.parents) {
        shasToRead.push(parent);
      }
    }

    return false;
  };

  const readWillDropOldOriginTipFromGraph = ({
    branch,
    oldSha,
    newSha,
  }: {
    branch: string;
    oldSha: string;
    newSha: string;
  }) => {
    if (
      readIsAncestorInGraph({
        ancestorSha: oldSha,
        descendantSha: newSha,
      })
    ) {
      return false;
    }

    const changedOriginRef = `origin/${branch}`;
    const rootShas = [newSha];

    for (const commit of commits) {
      if (commit.localBranches.length > 0) {
        rootShas.push(commit.sha);
      }

      for (const ref of commit.refs) {
        const refName = cleanRefName(ref);

        if (refName === "origin/HEAD" || refName === changedOriginRef) {
          continue;
        }

        rootShas.push(commit.sha);
      }
    }

    for (const worktree of worktrees) {
      if (worktree.head === null) {
        continue;
      }

      rootShas.push(worktree.head);
    }

    for (const rootSha of rootShas) {
      if (
        readIsAncestorInGraph({
          ancestorSha: oldSha,
          descendantSha: rootSha,
        })
      ) {
        return false;
      }
    }

    return true;
  };

  for (const branchSyncChange of branchSyncChanges) {
    if (
      branchSyncChange.gitRefType !== "branch" ||
      branchSyncChange.localSha === null ||
      branchSyncChange.originSha === null ||
      !readWillDropOldOriginTipFromGraph({
        branch: branchSyncChange.name,
        oldSha: branchSyncChange.originSha,
        newSha: branchSyncChange.localSha,
      })
    ) {
      continue;
    }

    const oldCommit = commitOfSha[branchSyncChange.originSha];
    const oldShortSha =
      oldCommit === undefined
        ? branchSyncChange.originSha.slice(0, 7)
        : oldCommit.shortSha;

    warningMessages.push(
      `Are you sure you want to push? Moving ${branchSyncChange.name} branch from ${oldShortSha} will drop that commit from the graph.`,
    );
  }

  return warningMessages;
};
