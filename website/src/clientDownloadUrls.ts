export const CLIENT_DOWNLOAD_PAGE_PATH =
  "https://github.com/glassdevtools/molttree/releases/latest";

type DetectedOS = {
  platform: "macos" | "windows";
  architecture: "arm64" | "x64";
};

type ClientDownload = DetectedOS & {
  fileName: string;
  href: string;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{
      architecture?: string;
      bitness?: string;
      platform?: string;
    }>;
  };
};

const clientDownloads: ClientDownload[] = [
  {
    platform: "macos",
    architecture: "arm64",
    fileName: "MoltTree_arm64.dmg",
    href: "https://github.com/glassdevtools/molttree/releases/latest/download/MoltTree_arm64.dmg",
  },
];

// This mirrors the desktop download detection from wgpu-test-4. A platform only
// gets a direct URL after CI publishes the static release asset for that target.
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
  architecture,
}: DetectedOS): ClientDownload | null => {
  for (const clientDownload of clientDownloads) {
    if (
      clientDownload.platform === platform &&
      clientDownload.architecture === architecture
    ) {
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

  let highEntropyValues: {
    architecture?: string;
    bitness?: string;
    platform?: string;
  };
  try {
    highEntropyValues = await userAgentData.getHighEntropyValues([
      "architecture",
      "bitness",
      "platform",
    ]);
  } catch {
    return null;
  }

  const platformText =
    `${highEntropyValues.platform ?? userAgentData.platform}`.toLowerCase();
  const platform = detectPlatform(platformText);
  if (platform === null) {
    return null;
  }

  const normalizedArchitecture = (
    highEntropyValues.architecture ?? ""
  ).toLowerCase();
  if (normalizedArchitecture === "arm" && highEntropyValues.bitness === "64") {
    return {
      platform,
      architecture: "arm64",
    };
  }
  if (normalizedArchitecture === "x86" && highEntropyValues.bitness === "64") {
    return {
      platform,
      architecture: "x64",
    };
  }
  return null;
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

  const architecture =
    platform === "macos"
      ? (detectMacArchitectureFromWebGl() ??
        detectArchitectureFromNavigatorText(platformText))
      : detectArchitectureFromNavigatorText(platformText);
  if (architecture === null) {
    return null;
  }
  return { platform, architecture };
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

const detectArchitectureFromNavigatorText = (
  platformText: string,
): DetectedOS["architecture"] | null => {
  if (platformText.includes("arm64") || platformText.includes("aarch64")) {
    return "arm64";
  }
  if (
    platformText.includes("win64") ||
    platformText.includes("wow64") ||
    platformText.includes("x86_64") ||
    platformText.includes("amd64") ||
    platformText.includes("x64")
  ) {
    return "x64";
  }
  return null;
};

const detectMacArchitectureFromWebGl = ():
  | DetectedOS["architecture"]
  | null => {
  const canvas = document.createElement("canvas");
  const renderingContext = canvas.getContext("webgl");
  if (!renderingContext) {
    return null;
  }

  const debugRendererInfo = renderingContext.getExtension(
    "WEBGL_debug_renderer_info",
  );
  if (debugRendererInfo === null) {
    return null;
  }

  const renderer = renderingContext.getParameter(
    debugRendererInfo.UNMASKED_RENDERER_WEBGL,
  );
  if (typeof renderer !== "string") {
    return null;
  }

  const normalizedRenderer = renderer.toLowerCase();
  if (normalizedRenderer.includes("software")) {
    return null;
  }
  if (normalizedRenderer.includes("apple")) {
    return "arm64";
  }
  if (
    normalizedRenderer.includes("intel") ||
    normalizedRenderer.includes("amd") ||
    normalizedRenderer.includes("radeon") ||
    normalizedRenderer.includes("nvidia")
  ) {
    return "x64";
  }
  return null;
};
