import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type AppServerNotification = {
  method: string;
  params: unknown;
};

export type AppServerClient = {
  request: ({
    method,
    params,
  }: {
    method: string;
    params: unknown;
  }) => Promise<unknown>;
  close: () => void;
};

const CODEX_DARWIN_COMMAND_PATH =
  "/Applications/Codex.app/Contents/Resources/codex";
// TODO: AI-PICKED-VALUE: The temp cache directory lets dev and packaged builds reuse one copied Codex binary per installed app version.
const CODEX_DARWIN_COMMAND_CACHE_DIR = join(tmpdir(), "molttree-codex-cli");
// TODO: AI-PICKED-VALUE: Ten seconds keeps startup bounded while giving Codex app-server enough time to answer normal requests.
const APP_SERVER_REQUEST_TIMEOUT_MS = 10000;

// The app-server client is the only place that speaks JSONL to Codex.

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

const readCodexCommand = () => {
  if (platform() === "darwin" && existsSync(CODEX_DARWIN_COMMAND_PATH)) {
    const codexCommandStat = statSync(CODEX_DARWIN_COMMAND_PATH);
    const codexCommandCopyPath = join(
      CODEX_DARWIN_COMMAND_CACHE_DIR,
      `codex-${codexCommandStat.size}-${Math.trunc(codexCommandStat.mtimeMs)}`,
    );

    if (!existsSync(codexCommandCopyPath)) {
      const codexCommandCopyPathForProcess = `${codexCommandCopyPath}.${process.pid}.tmp`;

      // Some macOS installs can hang before the bundled Codex CLI reaches its own startup code when it runs from inside the app bundle.
      mkdirSync(CODEX_DARWIN_COMMAND_CACHE_DIR, { recursive: true });
      copyFileSync(CODEX_DARWIN_COMMAND_PATH, codexCommandCopyPathForProcess);
      chmodSync(codexCommandCopyPathForProcess, 0o755);
      renameSync(codexCommandCopyPathForProcess, codexCommandCopyPath);
    }

    return codexCommandCopyPath;
  }

  return "codex";
};

const makeError = (message: string) => {
  return new Error(message);
};

export const createAppServerClient = async ({
  onNotification,
  onClose,
}: {
  onNotification: (notification: AppServerNotification) => void;
  onClose: () => void;
}) => {
  let nextRequestId = 1;
  let didClose = false;
  const pendingRequestOfId: { [id: number]: PendingRequest } = {};
  const appServerProcess = spawn(readCodexCommand(), ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lineReader = readline.createInterface({
    input: appServerProcess.stdout,
  });

  const rejectPendingRequests = (message: string) => {
    for (const idText of Object.keys(pendingRequestOfId)) {
      const id = Number(idText);
      const pendingRequest = pendingRequestOfId[id];
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(makeError(message));
      delete pendingRequestOfId[id];
    }
  };

  const finishClose = (message: string) => {
    if (didClose) {
      return;
    }

    didClose = true;
    lineReader.close();
    appServerProcess.kill();
    rejectPendingRequests(message);
    onClose();
  };

  const send = (message: unknown) => {
    appServerProcess.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const addPendingRequest = ({
    id,
    resolve,
    reject,
  }: {
    id: number;
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }) => {
    pendingRequestOfId[id] = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        delete pendingRequestOfId[id];
        finishClose("Codex app-server request timed out.");
        reject(makeError("Codex app-server request timed out."));
      }, APP_SERVER_REQUEST_TIMEOUT_MS),
    };
  };

  lineReader.on("line", (line) => {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!isObject(message)) {
      return;
    }

    if (typeof message.id !== "number") {
      if (typeof message.method === "string") {
        onNotification({ method: message.method, params: message.params });
      }

      return;
    }

    const pendingRequest = pendingRequestOfId[message.id];

    if (pendingRequest === undefined) {
      return;
    }

    clearTimeout(pendingRequest.timeout);
    delete pendingRequestOfId[message.id];

    if (isObject(message.error) && typeof message.error.message === "string") {
      pendingRequest.reject(makeError(message.error.message));
      return;
    }

    pendingRequest.resolve(message.result);
  });

  appServerProcess.stderr.on("data", () => {});
  appServerProcess.on("exit", () => {
    finishClose("Codex app-server exited.");
  });
  appServerProcess.on("error", (error) => {
    finishClose(error.message);
  });

  const request = ({ method, params }: { method: string; params: unknown }) => {
    if (didClose) {
      return Promise.reject(makeError("Codex app-server exited."));
    }

    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      addPendingRequest({ id, resolve, reject });
      send({ method, id, params });
    });
  };

  const initializePromise = new Promise<void>((resolve, reject) => {
    addPendingRequest({
      id: 0,
      resolve: () => resolve(),
      reject,
    });
  });

  send({
    method: "initialize",
    id: 0,
    params: {
      clientInfo: {
        name: "molttree",
        title: "MoltTree",
        version: "0",
      },
    },
  });
  send({ method: "initialized", params: {} });

  await initializePromise;

  const close = () => {
    finishClose("Codex app-server closed.");
  };
  const client: AppServerClient = { request, close };

  return client;
};