export const readCreatedGitRefName = (gitRefName: string) => {
  return gitRefName.trim().replace(/[^A-Za-z0-9._/-]+/g, "-");
};

const AUTOMATIC_BRANCH_PREFIX = "branchmaster";

export const readAutomaticBranchName = ({
  title,
  fallbackTitle,
  isBranchNameUsedOfBranch,
}: {
  title: string;
  fallbackTitle: string;
  isBranchNameUsedOfBranch: { [branch: string]: boolean };
}) => {
  // Automatic branches use a small branch-safe alphabet because they are created without showing the manual name dialog.
  const readBranchNameBase = (text: string) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  const titleBranchNameBase = readBranchNameBase(title);
  const fallbackBranchNameBase = readBranchNameBase(fallbackTitle);
  let branchNameBase = titleBranchNameBase;

  if (branchNameBase.length === 0) {
    branchNameBase = fallbackBranchNameBase;
  }

  if (branchNameBase.length === 0) {
    // TODO: AI-PICKED-VALUE: This is only used if both the chat title and thread id have no branch-safe characters.
    branchNameBase = "branch";
  }

  const branchNameWithoutNumber = `${AUTOMATIC_BRANCH_PREFIX}/${branchNameBase}`;

  if (isBranchNameUsedOfBranch[branchNameWithoutNumber] !== true) {
    return branchNameWithoutNumber;
  }

  let branchNumber = 2;
  let branchName = `${branchNameWithoutNumber}-${branchNumber}`;

  while (isBranchNameUsedOfBranch[branchName] === true) {
    branchNumber += 1;
    branchName = `${branchNameWithoutNumber}-${branchNumber}`;
  }

  return branchName;
};

export const readAutomaticCommitMessage = ({
  branch,
  isCommitMessageUsedOfMessage,
}: {
  branch: string;
  isCommitMessageUsedOfMessage: { [message: string]: boolean };
}) => {
  const commitMessageWithoutNumber = branch.startsWith(
    `${AUTOMATIC_BRANCH_PREFIX}/`,
  )
    ? branch
    : `${AUTOMATIC_BRANCH_PREFIX}/${branch}`;

  if (isCommitMessageUsedOfMessage[commitMessageWithoutNumber] !== true) {
    return commitMessageWithoutNumber;
  }

  let commitMessageNumber = 2;
  let commitMessage = `${commitMessageWithoutNumber}-${commitMessageNumber}`;

  while (isCommitMessageUsedOfMessage[commitMessage] === true) {
    commitMessageNumber += 1;
    commitMessage = `${commitMessageWithoutNumber}-${commitMessageNumber}`;
  }

  return commitMessage;
};
