import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import { readDashboardData } from "./dashboard";

// The main process owns local system access. The renderer only receives narrow, typed IPC methods through preload.
// TODO: AI-PICKED-VALUE: This initial window size gives the graph and thread sidebar enough room on a laptop display.
const MAIN_WINDOW_WIDTH = 1320;
const MAIN_WINDOW_HEIGHT = 860;
const MAIN_WINDOW_MIN_WIDTH = 980;
const MAIN_WINDOW_MIN_HEIGHT = 640;

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: "Molt Tree",
    backgroundColor: "#f6f4ef",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
};

const runGitCommandForPath = async ({
  path,
  args,
}: {
  path: string;
  args: string[];
}) => {
  await simpleGit({ baseDir: path }).raw(args);
};

ipcMain.handle("dashboard:read", async () => {
  return await readDashboardData();
});

ipcMain.handle("codex:openThread", async (_event, threadId: unknown) => {
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("threadId must be a non-empty string.");
  }

  await shell.openExternal(`codex://threads/${threadId}`);
});

ipcMain.handle("codex:openNewThread", async () => {
  await shell.openExternal("codex://new");
});

ipcMain.handle("vscode:openPath", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  await shell.openExternal(`vscode://file${pathToFileURL(path).pathname}`);
});

ipcMain.handle("git:stageChanges", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  await runGitCommandForPath({ path, args: ["add", "--all", "--", "."] });
});

ipcMain.handle("git:unstageChanges", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string.");
  }

  await runGitCommandForPath({
    path,
    args: ["restore", "--staged", "--", "."],
  });
});

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
