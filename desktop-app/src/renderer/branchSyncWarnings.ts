import type { GitBranchSyncChange, GitCommit } from "../shared/types";

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

const joinNames = (names: string[]) => {
  if (names.length <= 2) {
    return names.join(" and ");
  }

  return `${names.slice(0, names.length - 1).join(", ")}, and ${names[names.length - 1]}`;
};

// Push warnings tell the user when a push removes the last branch or tag from a commit.
export const readBranchSyncPushWarningMessages = ({
  branchSyncChanges,
  commits,
}: {
  branchSyncChanges: GitBranchSyncChange[];
  commits: GitCommit[];
}) => {
  const commitOfSha: { [sha: string]: GitCommit } = {};
  const isChangedOriginRefOfName: { [refName: string]: boolean } = {};
  const branchNamesOfSha: { [sha: string]: string[] } = {};
  const shortShaOfSha: { [sha: string]: string } = {};
  const warningMessages: string[] = [];

  for (const branchSyncChange of branchSyncChanges) {
    if (
      branchSyncChange.gitRefType !== "branch" ||
      branchSyncChange.originSha === null
    ) {
      continue;
    }

    isChangedOriginRefOfName[`origin/${branchSyncChange.name}`] = true;
  }

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

  const readWillRemoveLastBranchOrTagFromOldOriginTip = ({
    oldSha,
    newSha,
  }: {
    oldSha: string;
    newSha: string | null;
  }) => {
    if (
      newSha !== null &&
      readIsAncestorInGraph({
        ancestorSha: oldSha,
        descendantSha: newSha,
      })
    ) {
      return false;
    }

    const rootShas = newSha === null ? [] : [newSha];

    for (const commit of commits) {
      if (commit.localBranches.length > 0) {
        rootShas.push(commit.sha);
      }

      for (const ref of commit.refs) {
        const refName = cleanRefName(ref);

        if (
          refName === "HEAD" ||
          refName === "origin/HEAD" ||
          isChangedOriginRefOfName[refName] === true
        ) {
          continue;
        }

        rootShas.push(commit.sha);
      }
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
      branchSyncChange.originSha === null ||
      !readWillRemoveLastBranchOrTagFromOldOriginTip({
        oldSha: branchSyncChange.originSha,
        newSha: branchSyncChange.localSha,
      })
    ) {
      continue;
    }

    if (branchNamesOfSha[branchSyncChange.originSha] === undefined) {
      branchNamesOfSha[branchSyncChange.originSha] = [];
    }

    branchNamesOfSha[branchSyncChange.originSha].push(branchSyncChange.name);

    if (shortShaOfSha[branchSyncChange.originSha] === undefined) {
      const oldCommit = commitOfSha[branchSyncChange.originSha];
      shortShaOfSha[branchSyncChange.originSha] =
        oldCommit === undefined
          ? branchSyncChange.originSha.slice(0, 7)
          : oldCommit.shortSha;
    }
  }

  for (const sha of Object.keys(branchNamesOfSha)) {
    const branchNames = branchNamesOfSha[sha];
    const shortSha = shortShaOfSha[sha];

    if (branchNames === undefined || shortSha === undefined) {
      continue;
    }

    warningMessages.push(
      `${shortSha} will disappear from the tree because ${joinNames(branchNames)} won't be there to point to it anymore.`,
    );
  }

  return warningMessages;
};
