import { BrowserWindow } from "electron";
import type { App } from "electron";
import type { AppUpdater } from "electron-updater";

import { existsSync } from "node:fs";

import { join } from "node:path";
import type { AppUpdateStatus } from "../shared/types";

const APP_UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;

const readAppUpdateErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Failed to update Crabtree.";
};

export const createAppUpdateController = ({
  app,
  autoUpdater,
}: {
  app: App;
  autoUpdater: AppUpdater;
}) => {
  let appUpdateStatus: AppUpdateStatus = { type: "unavailable" };
  let isAppUpdateConfigured = false;
  let isAppUpdateCheckRunning = false;
  let appUpdateCheckInterval: ReturnType<typeof setInterval> | null = null;

  const sendAppUpdateStatus = () => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.webContents.send(
        "appUpdate:statusChanged",
        appUpdateStatus,
      );
    }
  };

  const setAppUpdateStatus = (nextAppUpdateStatus: AppUpdateStatus) => {
    appUpdateStatus = nextAppUpdateStatus;
    sendAppUpdateStatus();
  };

  const checkForAppUpdate = async () => {
    if (
      !isAppUpdateConfigured ||
      isAppUpdateCheckRunning ||
      appUpdateStatus.type === "downloading" ||
      appUpdateStatus.type === "ready"
    ) {
      return appUpdateStatus;
    }

    isAppUpdateCheckRunning = true;

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      setAppUpdateStatus({
        type: "error",
        message: readAppUpdateErrorMessage(error),
      });
    } finally {
      isAppUpdateCheckRunning = false;

      if (appUpdateStatus.type === "checking") {
        setAppUpdateStatus({ type: "idle" });
      }
    }

    return appUpdateStatus;
  };

  const start = () => {
    if (!app.isPackaged) {
      return;
    }

    const appUpdateConfigPath = join(process.resourcesPath, "app-update.yml");
    if (!existsSync(appUpdateConfigPath)) {
      return;
    }

    isAppUpdateConfigured = true;
    setAppUpdateStatus({ type: "idle" });

    // Release builds get their update feed from Electron Builder's app-update.yml.
    autoUpdater.on("checking-for-update", () => {
      if (appUpdateStatus.type !== "ready") {
        setAppUpdateStatus({ type: "checking" });
      }
    });
    autoUpdater.on("update-available", (info) => {
      if (appUpdateStatus.type !== "ready") {
        setAppUpdateStatus({ type: "downloading", version: info.version });
      }
    });
    autoUpdater.on("update-not-available", () => {
      if (appUpdateStatus.type !== "ready") {
        setAppUpdateStatus({ type: "idle" });
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      setAppUpdateStatus({ type: "ready", version: info.version });
    });
    autoUpdater.on("error", (error) => {
      console.error("Failed to update Crabtree.", error);

      if (appUpdateStatus.type !== "ready") {
        setAppUpdateStatus({
          type: "error",
          message: readAppUpdateErrorMessage(error),
        });
      }
    });

    void checkForAppUpdate();
    appUpdateCheckInterval = setInterval(() => {
      void checkForAppUpdate();
    }, APP_UPDATE_CHECK_INTERVAL_MS);
  };

  const stop = () => {
    if (appUpdateCheckInterval === null) {
      return;
    }

    clearInterval(appUpdateCheckInterval);
    appUpdateCheckInterval = null;
  };

  const quitAndInstall = () => {
    if (appUpdateStatus.type !== "ready") {
      throw new Error("No downloaded app update is ready.");
    }

    autoUpdater.quitAndInstall();
  };

  return {
    checkForAppUpdate,
    quitAndInstall,
    readStatus: () => appUpdateStatus,
    start,
    stop,
  };
};
