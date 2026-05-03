export const CLIENT_DOWNLOAD_PAGE_PATH =
  "https://github.com/glassdevtools/crabtree/releases/latest";

type DetectedOS = {
  platform: "macos" | "windows";
};

type ClientDownload = DetectedOS & {
  href: string;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{ platform?: string }>;
  };
};

const clientDownloads: ClientDownload[] = [
  {
    platform: "macos",
    href: "https://github.com/glassdevtools/crabtree/releases/latest/download/latest.dmg",
  },
];

// A platform only gets a direct URL after CI publishes the static release asset for that target.
export const getAutoDetectedDownloadUrl = async (): Promise<string | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  const detectedOS =
    (await detectOSFromClientHints(window.navigator)) ??
    detectOSFromNavigator(window.navigator);
  if (detectedOS === null) {
    return null;
  }

  return getDownloadUrlForOS(detectedOS)?.href ?? null;
};

const getDownloadUrlForOS = ({
  platform,
}: DetectedOS): ClientDownload | null => {
  for (const clientDownload of clientDownloads) {
    if (clientDownload.platform === platform) {
      return clientDownload;
    }
  }
  return null;
};

const detectOSFromClientHints = async (
  browserNavigator: NavigatorWithUserAgentData,
): Promise<DetectedOS | null> => {
  const userAgentData = browserNavigator.userAgentData;
  if (!userAgentData?.getHighEntropyValues) {
    return null;
  }

  let highEntropyValues: { platform?: string };
  try {
    highEntropyValues = await userAgentData.getHighEntropyValues(["platform"]);
  } catch {
    return null;
  }

  const platformText =
    `${highEntropyValues.platform ?? userAgentData.platform}`.toLowerCase();
  const platform = detectPlatform(platformText);
  return platform === null ? null : { platform };
};

const detectOSFromNavigator = (
  browserNavigator: NavigatorWithUserAgentData,
): DetectedOS | null => {
  const platformText =
    `${browserNavigator.userAgentData?.platform ?? ""} ${browserNavigator.platform} ${browserNavigator.userAgent}`.toLowerCase();
  const platform = detectPlatform(platformText);
  if (platform === null) {
    return null;
  }
  if (platform === "macos" && window.navigator.maxTouchPoints > 1) {
    return null;
  }

  return { platform };
};

const detectPlatform = (
  platformText: string,
): DetectedOS["platform"] | null => {
  if (platformText.includes("mac")) {
    return "macos";
  }
  if (platformText.includes("win")) {
    return "windows";
  }
  return null;
};
