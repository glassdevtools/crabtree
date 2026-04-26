import { spawn } from "node:child_process";
import readline from "node:readline";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
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

const isObject = (value: unknown): value is { [key: string]: unknown } => {
  return typeof value === "object" && value !== null;
};

const makeError = (message: string) => {
  return new Error(message);
};

export const createAppServerClient = async () => {
  let nextRequestId = 1;
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

  const rejectPendingRequests = (message: string) => {
    for (const idText of Object.keys(pendingRequestOfId)) {
      const id = Number(idText);
      pendingRequestOfId[id].reject(makeError(message));
      delete pendingRequestOfId[id];
    }
  };

  lineReader.on("line", (line) => {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!isObject(message) || typeof message.id !== "number") {
      return;
    }

    const pendingRequest = pendingRequestOfId[message.id];

    if (pendingRequest === undefined) {
      return;
    }

    delete pendingRequestOfId[message.id];

    if (isObject(message.error) && typeof message.error.message === "string") {
      pendingRequest.reject(makeError(message.error.message));
      return;
    }

    pendingRequest.resolve(message.result);
  });

  appServerProcess.on("exit", () => {
    rejectPendingRequests("Codex app-server exited.");
  });

  appServerProcess.on("error", (error) => {
    rejectPendingRequests(error.message);
  });

  const request = ({ method, params }: { method: string; params: unknown }) => {
    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise<unknown>((resolve, reject) => {
      pendingRequestOfId[id] = { resolve, reject };
      send({ method, id, params });
    });
  };

  const initializePromise = new Promise<void>((resolve, reject) => {
    pendingRequestOfId[0] = {
      resolve: () => resolve(),
      reject,
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
