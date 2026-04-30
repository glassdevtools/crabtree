import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ANALYTICS_INSTALL_ID_FILE_NAME = "analytics-install-id";
const ANALYTICS_INSTALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const readIsMissingFileError = (error: unknown) => {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
};

const readIsAnalyticsInstallId = (value: string) => {
  return ANALYTICS_INSTALL_ID_PATTERN.test(value);
};

// The install ID is random and stored in Electron's user data folder, so analytics can group one app install without reading hardware details.
export const readOrCreateAnalyticsInstallId = async ({
  userDataPath,
}: {
  userDataPath: string;
}) => {
  const analyticsInstallIdPath = join(
    userDataPath,
    ANALYTICS_INSTALL_ID_FILE_NAME,
  );

  try {
    const analyticsInstallId = (
      await readFile(analyticsInstallIdPath, "utf8")
    ).trim();

    if (!readIsAnalyticsInstallId(analyticsInstallId)) {
      throw new Error("Stored analytics install ID is invalid.");
    }

    return analyticsInstallId;
  } catch (error) {
    if (!readIsMissingFileError(error)) {
      throw error;
    }
  }

  const analyticsInstallId = randomUUID();
  await mkdir(userDataPath, { recursive: true });
  await writeFile(analyticsInstallIdPath, `${analyticsInstallId}\n`, "utf8");

  return analyticsInstallId;
};
