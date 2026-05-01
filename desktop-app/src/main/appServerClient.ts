import { spawn } from "node:child_process";
import readline from "node:readline";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
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

// The app-server client is the only place that speaks JSONL to Codex.
// Everything else calls this small request wrapper instead of touching Codex files.
// TODO: AI-PICKED-VALUE: This points at the bundled Codex binary from the macOS desktop app so Finder-launched Electron builds do not depend on shell PATH.
const CODEX_BINARY_PATH = "/Applications/Codex.app/Contents/Resources/codex";
// TODO: AI-PICKED-VALUE: This turns Codex app-server stalls into visible app errors instead of an endless loading state.
const APP_SERVER_REQUEST_TIMEOUT_MS = 30_000;

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
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
  const appServerProcess = spawn(CODEX_BINARY_PATH, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lineReader = readline.createInterface({
    input: appServerProcess.stdout,
  });

  const send = (message: unknown) => {
    appServerProcess.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const deletePendingRequest = (id: number) => {
    const pendingRequest = pendingRequestOfId[id];

    if (pendingRequest === undefined) {
      return null;
    }

    clearTimeout(pendingRequest.timeoutId);
    delete pendingRequestOfId[id];

    return pendingRequest;
  };

  const rejectPendingRequests = (message: string) => {
    for (const idText of Object.keys(pendingRequestOfId)) {
      const id = Number(idText);
      const pendingRequest = deletePendingRequest(id);

      if (pendingRequest !== null) {
        pendingRequest.reject(makeError(message));
      }
    }
  };
  const finishClose = (message: string) => {
    if (didClose) {
      return;
    }

    didClose = true;
    rejectPendingRequests(message);
    onClose();
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

    const pendingRequest = deletePendingRequest(message.id);

    if (pendingRequest === null) {
      return;
    }

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
      const timeoutId = setTimeout(() => {
        const pendingRequest = deletePendingRequest(id);

        if (pendingRequest !== null) {
          pendingRequest.reject(
            makeError(
              `${method} timed out after ${APP_SERVER_REQUEST_TIMEOUT_MS}ms.`,
            ),
          );
        }
      }, APP_SERVER_REQUEST_TIMEOUT_MS);

      pendingRequestOfId[id] = { resolve, reject, timeoutId };
      send({ method, id, params });
    });
  };

  const initializePromise = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const pendingRequest = deletePendingRequest(0);

      if (pendingRequest !== null) {
        pendingRequest.reject(
          makeError(
            `initialize timed out after ${APP_SERVER_REQUEST_TIMEOUT_MS}ms.`,
          ),
        );
      }
    }, APP_SERVER_REQUEST_TIMEOUT_MS);

    pendingRequestOfId[0] = {
      resolve: () => resolve(),
      reject,
      timeoutId,
    };
  });

  send({
    method: "initialize",
    id: 0,
    params: {
      clientInfo: {
        name: "molttree",
        title: "MoltTree",
        version: "0.1.0",
      },
    },
  });
  send({ method: "initialized", params: {} });

  await initializePromise;

  const close = () => {
    lineReader.close();
    appServerProcess.kill();
  };

  const client: AppServerClient = { request, close };

  return client;
};
