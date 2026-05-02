import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
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

export type AppServerConnectionKind = "direct" | "proxy";

const CODEX_DARWIN_COMMAND_PATH =
  "/Applications/Codex.app/Contents/Resources/codex";
// TODO: AI-PICKED-VALUE: Ten seconds keeps startup bounded while giving Codex app-server enough time to answer normal requests.
const APP_SERVER_REQUEST_TIMEOUT_MS = 10000;

// The app-server client is the only place that speaks JSONL to Codex.

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

const readCodexCommand = () => {
  if (platform() === "darwin" && existsSync(CODEX_DARWIN_COMMAND_PATH)) {
    return CODEX_DARWIN_COMMAND_PATH;
  }

  return "codex";
};

const readAppServerArgs = (connectionKind: AppServerConnectionKind) => {
  if (connectionKind === "proxy") {
    return ["app-server", "proxy"];
  }

  return ["app-server"];
};

const makeError = (message: string) => {
  return new Error(message);
};

export const createAppServerClient = async ({
  connectionKind,
  onNotification,
  onClose,
}: {
  connectionKind: AppServerConnectionKind;
  onNotification: (notification: AppServerNotification) => void;
  onClose: () => void;
}) => {
  let nextRequestId = 1;
  let didClose = false;
  const pendingRequestOfId: { [id: number]: PendingRequest } = {};
  const appServerProcess = spawn(
    readCodexCommand(),
    readAppServerArgs(connectionKind),
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
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
