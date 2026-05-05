import { execFile } from "node:child_process";
import { chmod, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as pty from "@lydell/node-pty";
import type {
  TerminalSessionEvent,
  TerminalSessionResizeRequest,
  TerminalSessionSnapshot,
  TerminalSessionStartRequest,
  TerminalSessionSummary,
  TerminalSessionWriteRequest,
} from "../shared/types";

// The main process owns terminal processes so renderer code never gets direct shell access.
type TerminalSession = {
  cwd: string;
  terminal: pty.IPty | null;
  dataDisposable: pty.IDisposable | null;
  exitDisposable: pty.IDisposable | null;
  busyCheckInterval: ReturnType<typeof setInterval> | null;
  isBusyCheckRunning: boolean;
  output: string;
  cursor: number;
  isRunning: boolean;
  isBusy: boolean;
};

// TODO: AI-PICKED-VALUE: Keep two megabytes of terminal output, matching opencode's PTY buffer size so reconnects have enough history without unbounded memory growth.
const TERMINAL_SESSION_OUTPUT_MAX_LENGTH = 1024 * 1024 * 2;
// TODO: AI-PICKED-VALUE: Polling twice per second makes the busy spinner responsive without running a process-table query on every terminal keystroke.
const TERMINAL_SESSION_BUSY_POLL_INTERVAL_MS = 500;
// TODO: AI-PICKED-VALUE: One second is enough for local process-table queries and avoids keeping a stale busy spinner when the query hangs.
const TERMINAL_SESSION_BUSY_QUERY_TIMEOUT_MS = 1000;
// TODO: AI-PICKED-VALUE: Two megabytes is enough for normal process listings without letting a bad query allocate unbounded output.
const TERMINAL_SESSION_BUSY_QUERY_MAX_BUFFER_LENGTH = 1024 * 1024 * 2;
let didEnsureTerminalSpawnHelperCanRun = false;

type ProcessRow = {
  pid: number;
  parentPid: number;
};

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

const readTerminalSessionCwd = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Terminal session needs a cwd.");
  }

  return value;
};

export const readTerminalSessionStopRequest = (value: unknown) => {
  return readTerminalSessionCwd(value);
};

const readTerminalDimension = (value: unknown, name: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Terminal session needs a positive ${name}.`);
  }

  return value;
};

export const readTerminalSessionStartRequest = (
  value: unknown,
): TerminalSessionStartRequest => {
  if (!isObject(value)) {
    throw new Error("Terminal session start request must be an object.");
  }

  return {
    cwd: readTerminalSessionCwd(value.cwd),
    cols: readTerminalDimension(value.cols, "column count"),
    rows: readTerminalDimension(value.rows, "row count"),
  };
};

export const readTerminalSessionWriteRequest = (
  value: unknown,
): TerminalSessionWriteRequest => {
  if (!isObject(value)) {
    throw new Error("Terminal session write request must be an object.");
  }

  if (typeof value.data !== "string") {
    throw new Error("Terminal session write request needs data.");
  }

  return {
    cwd: readTerminalSessionCwd(value.cwd),
    data: value.data,
  };
};

export const readTerminalSessionResizeRequest = (
  value: unknown,
): TerminalSessionResizeRequest => {
  if (!isObject(value)) {
    throw new Error("Terminal session resize request must be an object.");
  }

  return {
    cwd: readTerminalSessionCwd(value.cwd),
    cols: readTerminalDimension(value.cols, "column count"),
    rows: readTerminalDimension(value.rows, "row count"),
  };
};

const readTerminalShell = () => {
  switch (process.platform) {
    case "win32":
      return { command: "powershell.exe", args: [] };
    case "darwin":
      return { command: "/bin/zsh", args: ["-l"] };
    default:
      return { command: "/bin/bash", args: ["-l"] };
  }
};

const readTerminalEnv = () => {
  const terminalEnv: { [key: string]: string } = {};

  for (const key of Object.keys(process.env)) {
    const value = process.env[key];

    if (value === undefined) {
      continue;
    }

    terminalEnv[key] = value;
  }

  terminalEnv.TERM = "xterm-256color";

  return terminalEnv;
};

const readProcessRowsWithFile = ({
  file,
  args,
}: {
  file: string;
  args: string[];
}) => {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: TERMINAL_SESSION_BUSY_QUERY_TIMEOUT_MS,
        maxBuffer: TERMINAL_SESSION_BUSY_QUERY_MAX_BUFFER_LENGTH,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve(stdout);
      },
    );
  });
};

const readProcessRowsFromPsOutput = (output: string) => {
  const processRows: ProcessRow[] = [];

  for (const line of output.split("\n")) {
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0) {
      continue;
    }

    const [pidText, parentPidText] = trimmedLine.split(/\s+/);
    const pid = Number(pidText);
    const parentPid = Number(parentPidText);

    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parentPid)) {
      continue;
    }

    processRows.push({ pid, parentPid });
  }

  return processRows;
};

const readProcessRowsFromWindowsCsv = (output: string) => {
  const processRows: ProcessRow[] = [];

  for (const line of output.split("\n")) {
    const trimmedLine = line.trim();

    if (
      trimmedLine.length === 0 ||
      trimmedLine === '"ProcessId","ParentProcessId"'
    ) {
      continue;
    }

    const [pidText, parentPidText] = trimmedLine
      .replace(/^"|"$/g, "")
      .split('","');
    const pid = Number(pidText);
    const parentPid = Number(parentPidText);

    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parentPid)) {
      continue;
    }

    processRows.push({ pid, parentPid });
  }

  return processRows;
};

const readProcessRows = async () => {
  switch (process.platform) {
    case "win32": {
      const output = await readProcessRowsWithFile({
        file: "powershell.exe",
        args: [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation",
        ],
      });

      return readProcessRowsFromWindowsCsv(output);
    }
    default: {
      const output = await readProcessRowsWithFile({
        file: "/bin/ps",
        args: ["-axo", "pid=,ppid="],
      });

      return readProcessRowsFromPsOutput(output);
    }
  }
};

const readIsTerminalShellBusy = async (shellPid: number) => {
  const processRows = await readProcessRows();

  for (const processRow of processRows) {
    if (processRow.parentPid === shellPid) {
      return true;
    }
  }

  return false;
};

const ensureTerminalSpawnHelperCanRun = async () => {
  if (process.platform === "win32" || didEnsureTerminalSpawnHelperCanRun) {
    return;
  }

  const nodePtyPackage = `@lydell/node-pty-${process.platform}-${process.arch}`;
  const nodePtyIndexPath = require.resolve(nodePtyPackage);
  const nodePtyRoot = dirname(dirname(nodePtyIndexPath));
  const spawnHelperPath = join(
    nodePtyRoot,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  )
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked");

  await chmod(spawnHelperPath, 0o755);
  didEnsureTerminalSpawnHelperCanRun = true;
};

const readTerminalSessionSnapshot = (
  terminalSession: TerminalSession,
): TerminalSessionSnapshot => {
  return {
    cwd: terminalSession.cwd,
    output: terminalSession.output,
    isRunning: terminalSession.isRunning,
    isBusy: terminalSession.isBusy,
    cursor: terminalSession.cursor,
  };
};

const readTerminalSessionSummary = (
  terminalSession: TerminalSession,
): TerminalSessionSummary => {
  return {
    cwd: terminalSession.cwd,
    isRunning: terminalSession.isRunning,
    isBusy: terminalSession.isBusy,
  };
};

const appendTerminalSessionOutput = ({
  terminalSession,
  data,
}: {
  terminalSession: TerminalSession;
  data: string;
}) => {
  terminalSession.cursor += data.length;
  terminalSession.output += data;

  if (terminalSession.output.length > TERMINAL_SESSION_OUTPUT_MAX_LENGTH) {
    const excessLength =
      terminalSession.output.length - TERMINAL_SESSION_OUTPUT_MAX_LENGTH;
    terminalSession.output = terminalSession.output.slice(excessLength);
  }
};

const disposeTerminalSessionListeners = (terminalSession: TerminalSession) => {
  terminalSession.dataDisposable?.dispose();
  terminalSession.exitDisposable?.dispose();
  if (terminalSession.busyCheckInterval !== null) {
    clearInterval(terminalSession.busyCheckInterval);
  }

  terminalSession.dataDisposable = null;
  terminalSession.exitDisposable = null;
  terminalSession.busyCheckInterval = null;
  terminalSession.isBusyCheckRunning = false;
};

const readIsDirectory = async (path: string) => {
  const stats = await stat(path);

  return stats.isDirectory();
};

export const createTerminalSessionController = ({
  sendTerminalSessionEvent,
}: {
  sendTerminalSessionEvent: (
    terminalSessionEvent: TerminalSessionEvent,
  ) => void;
}) => {
  const terminalSessionOfCwd: { [cwd: string]: TerminalSession } = {};

  const sendTerminalSessionStatus = (terminalSession: TerminalSession) => {
    sendTerminalSessionEvent({
      type: "status",
      cwd: terminalSession.cwd,
      isRunning: terminalSession.isRunning,
      isBusy: terminalSession.isBusy,
      cursor: terminalSession.cursor,
    });
  };

  const updateTerminalSessionBusy = async (
    terminalSession: TerminalSession,
  ) => {
    if (
      terminalSession.isBusyCheckRunning ||
      !terminalSession.isRunning ||
      terminalSession.terminal === null
    ) {
      return;
    }

    terminalSession.isBusyCheckRunning = true;

    try {
      const isBusy = await readIsTerminalShellBusy(
        terminalSession.terminal.pid,
      );

      if (
        terminalSession.isRunning &&
        terminalSession.terminal !== null &&
        terminalSession.isBusy !== isBusy
      ) {
        terminalSession.isBusy = isBusy;
        sendTerminalSessionStatus(terminalSession);
      }
    } catch (error) {
      console.error("Failed to read terminal busy state.", error);

      if (terminalSession.isBusy) {
        terminalSession.isBusy = false;
        sendTerminalSessionStatus(terminalSession);
      }
    } finally {
      terminalSession.isBusyCheckRunning = false;
    }
  };

  const startTerminalSessionBusyPolling = (
    terminalSession: TerminalSession,
  ) => {
    terminalSession.busyCheckInterval = setInterval(() => {
      void updateTerminalSessionBusy(terminalSession);
    }, TERMINAL_SESSION_BUSY_POLL_INTERVAL_MS);

    void updateTerminalSessionBusy(terminalSession);
  };

  const readTerminalSessions = () => {
    return Object.keys(terminalSessionOfCwd).map((cwd) =>
      readTerminalSessionSummary(terminalSessionOfCwd[cwd]),
    );
  };

  const startTerminalSession = async (request: TerminalSessionStartRequest) => {
    if (!(await readIsDirectory(request.cwd))) {
      throw new Error("Terminal cwd must be a directory.");
    }

    const currentTerminalSession = terminalSessionOfCwd[request.cwd];

    if (
      currentTerminalSession !== undefined &&
      currentTerminalSession.isRunning
    ) {
      currentTerminalSession.terminal?.resize(request.cols, request.rows);
      return readTerminalSessionSnapshot(currentTerminalSession);
    }

    if (currentTerminalSession !== undefined) {
      disposeTerminalSessionListeners(currentTerminalSession);
    }

    await ensureTerminalSpawnHelperCanRun();

    const terminalSession: TerminalSession = {
      cwd: request.cwd,
      terminal: null,
      dataDisposable: null,
      exitDisposable: null,
      busyCheckInterval: null,
      isBusyCheckRunning: false,
      output: "",
      cursor: 0,
      isRunning: true,
      isBusy: false,
    };
    const terminalShell = readTerminalShell();

    const terminal = pty.spawn(terminalShell.command, terminalShell.args, {
      name: "xterm-256color",
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: readTerminalEnv(),
    });
    terminalSession.terminal = terminal;
    terminalSessionOfCwd[request.cwd] = terminalSession;
    terminalSession.dataDisposable = terminal.onData((data) => {
      appendTerminalSessionOutput({ terminalSession, data });
      sendTerminalSessionEvent({
        type: "data",
        cwd: terminalSession.cwd,
        data,
        cursor: terminalSession.cursor,
      });
    });
    terminalSession.exitDisposable = terminal.onExit(() => {
      terminalSession.isRunning = false;
      terminalSession.isBusy = false;
      terminalSession.terminal = null;
      disposeTerminalSessionListeners(terminalSession);
      sendTerminalSessionStatus(terminalSession);
    });
    startTerminalSessionBusyPolling(terminalSession);
    sendTerminalSessionStatus(terminalSession);

    return readTerminalSessionSnapshot(terminalSession);
  };

  const writeTerminalSession = (request: TerminalSessionWriteRequest) => {
    const terminalSession = terminalSessionOfCwd[request.cwd];

    if (
      terminalSession === undefined ||
      !terminalSession.isRunning ||
      terminalSession.terminal === null
    ) {
      throw new Error("Terminal session is not running.");
    }

    terminalSession.terminal.write(request.data);
  };

  const resizeTerminalSession = (request: TerminalSessionResizeRequest) => {
    const terminalSession = terminalSessionOfCwd[request.cwd];

    if (terminalSession === undefined || !terminalSession.isRunning) {
      return;
    }

    terminalSession.terminal?.resize(request.cols, request.rows);
  };

  const stopTerminalSession = (cwd: string) => {
    const terminalSession = terminalSessionOfCwd[cwd];

    if (terminalSession === undefined || !terminalSession.isRunning) {
      return;
    }

    terminalSession.terminal?.kill();
  };

  const stopAllTerminalSessions = () => {
    for (const cwd of Object.keys(terminalSessionOfCwd)) {
      stopTerminalSession(cwd);
    }
  };

  return {
    readTerminalSessions,
    startTerminalSession,
    writeTerminalSession,
    resizeTerminalSession,
    stopTerminalSession,
    stopAllTerminalSessions,
  };
};
