// Git commands need the user's normal environment so global Git config and excludes keep working.
export const readGitChildProcessEnv = () => {
  const gitEnv: { [key: string]: string } = {};

  for (const key of Object.keys(process.env)) {
    const value = process.env[key];

    if (value === undefined) {
      continue;
    }

    gitEnv[key] = value;
  }

  gitEnv.GIT_TERMINAL_PROMPT = "0";

  delete gitEnv.PAGER;
  delete gitEnv.GIT_PAGER;
  delete gitEnv.EDITOR;
  delete gitEnv.VISUAL;
  delete gitEnv.GIT_EDITOR;
  delete gitEnv.GIT_SEQUENCE_EDITOR;

  return gitEnv;
};
