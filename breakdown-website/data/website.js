// This file covers only the public Next.js marketing and download website.
window.breakdownWebsiteData = window.breakdownWebsiteData || {};

window.breakdownWebsiteData.website = {
  id: "website",
  title: "Website UI State Breakdown",
  eyebrow: "website/",
  summary:
    "The website is a single marketing page. Its functional state is download link routing, tracked button locations, FAQ expansion, and PostHog client setup.",
  sourceFiles: [
    "website/README.md",
    "website/app/page.tsx",
    "website/app/client-download-link.tsx",
    "website/app/client-github-link.tsx",
    "website/src/clientDownloadUrls.ts",
    "website/src/analytics.ts",
    "website/instrumentation-client.ts",
    "website/next.config.ts",
  ],
  highLevelVariables: [
    {
      variable: "downloadHref",
      source: "ClientDownloadLink plus getAutoDetectedDownloadUrl",
      states: "latestReleasePage, macDmg",
      notes:
        "The link starts on the latest GitHub Release page, then client detection may switch macOS users to BranchMaster.dmg.",
    },
    {
      variable: "detectedPlatform",
      source:
        "navigator.userAgentData, navigator.platform, navigator.userAgent",
      states: "macos, windows, unknown, detectionFailed",
      notes:
        "macOS iPad-like touch devices are treated as unknown so they stay on the generic release page.",
    },
    {
      variable: "buttonLocation",
      source: "ClientDownloadLink and ClientGithubLink props",
      states: "nav, hero, cta",
      notes:
        "These values are analytics properties. The footer GitHub link is a plain anchor in the current code.",
    },
    {
      variable: "posthogClient",
      source: "instrumentation-client.ts",
      states: "configured, missingProjectToken",
      notes:
        "The website assumes NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN exists. Pageview, pageleave, autocapture, heatmaps, exceptions, campaign params, and referrer capture are currently enabled.",
    },
    {
      variable: "faqDisclosure",
      source: "Native details elements in page.tsx",
      states: "closed, open",
      notes:
        "Each FAQ item owns its browser disclosure state. React does not store this state.",
    },
    {
      variable: "viewport",
      source: "CSS media queries",
      states: "desktopLayout, mobileLayout",
      notes:
        "The same sections render in both layouts. The change is layout density, wrapping, and image sizing, not product behavior.",
    },
  ],
  variableTypes: [
    {
      name: "WebsiteDownloadHrefState",
      typeScript: `type WebsiteDownloadHrefState =
  | { type: "latestReleasePage"; href: "https://github.com/glassdevtools/branchmaster/releases/latest" }
  | { type: "macDmg"; href: "https://github.com/glassdevtools/branchmaster/releases/latest/download/BranchMaster.dmg" };`,
    },
    {
      name: "WebsiteDetectedPlatformState",
      typeScript: `type WebsiteDetectedPlatformState =
  | { type: "macos"; source: "clientHints" | "navigatorText" }
  | { type: "windows"; source: "clientHints" | "navigatorText" }
  | { type: "unknown"; reason: "unsupportedPlatform" | "ipadLikeMac" | "server" }
  | { type: "detectionFailed"; reason: "clientHintsRejected" };`,
    },
    {
      name: "WebsiteButtonLocationState",
      typeScript: `type WebsiteButtonLocationState =
  | { type: "nav"; eventName: "download_app_clicked" | "github_clicked" }
  | { type: "hero"; eventName: "download_app_clicked" | "github_clicked" }
  | { type: "cta"; eventName: "download_app_clicked" | "github_clicked" };`,
    },
    {
      name: "WebsitePostHogState",
      typeScript: `type WebsitePostHogState =
  | { type: "configured"; projectToken: string; apiHost: "/ingest"; uiHost: "https://us.posthog.com" }
  | { type: "missingProjectToken"; projectToken: undefined; userVisibleStateChange: false };`,
    },
    {
      name: "WebsiteFaqDisclosureState",
      typeScript: `type WebsiteFaqDisclosureState =
  | { type: "closed"; question: string }
  | { type: "open"; question: string; answer: string[] };`,
    },
    {
      name: "WebsiteViewportState",
      typeScript: `type WebsiteViewportState =
  | { type: "desktopLayout"; sections: "fullMarketingPage" }
  | { type: "mobileLayout"; sections: "fullMarketingPage" };`,
    },
  ],
  flowchart: `flowchart TD
  route["/ website route"] --> staticPage["Render static marketing sections"]
  staticPage --> hydrate["Client components hydrate"]
  hydrate --> hrefStart["Download href: latest release page"]
  hrefStart --> detect{"Detect client platform"}
  detect -->|macOS desktop| mac["Download href: BranchMaster.dmg"]
  detect -->|Windows| generic
  detect -->|Unknown or failed| generic["Keep latest release page"]
  staticPage --> faq["FAQ details"]
  faq --> faqClosed["FAQ closed"]
  faq --> faqOpen["FAQ open"]
  staticPage --> links["Clickable buttons and links"]
  links --> downloadClick["Download click: track download_app_clicked"]
  links --> githubClick["GitHub click: track github_clicked for nav, hero, cta"]
  links --> footerGitHub["Footer GitHub click: plain anchor"]
  downloadClick --> githubRelease["Browser opens GitHub release URL"]
  githubClick --> githubRepo["Browser opens GitHub repo"]
  staticPage --> posthog{"PostHog token present?"}
  posthog -->|Yes| analytics["Pageview and client events sent through /ingest"]
  posthog -->|No| analyticsMissing["Analytics client has no valid project token"]`,
  backgroundStates: [
    {
      state: "Static Next.js render",
      trigger: "Initial page request",
      behavior:
        "The page renders the marketing sections, images, FAQ markup, and client component placeholders.",
    },
    {
      state: "Hydrated download link detection",
      trigger: "ClientDownloadLink mounts",
      behavior:
        "The client reads browser platform hints and updates only the download href.",
    },
    {
      state: "PostHog browser analytics",
      trigger: "instrumentation-client.ts runs in the browser",
      behavior:
        "Events go through the /ingest rewrite to https://us.i.posthog.com. Missing token does not render a different UI.",
    },
    {
      state: "FAQ disclosure state",
      trigger: "User opens or closes a details element",
      behavior:
        "The browser toggles the answer display. No app state or backend request is involved.",
    },
  ],
  backendProducts: [
    {
      product: "PostHog",
      usedBy: "Website analytics",
      neededOutsideRepo:
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is required but .env.local is ignored. NEXT_PUBLIC_POSTHOG_HOST exists locally but the current website code does not read it.",
      expectedSource:
        "website/.env.local for local development and production host env vars for deploys.",
    },
    {
      product: "PostHog ingestion proxy",
      usedBy: "Website analytics network requests",
      neededOutsideRepo:
        "No extra env var. website/next.config.ts rewrites /ingest to https://us.i.posthog.com.",
      expectedSource:
        "Checked-in Next.js config plus reachable PostHog network.",
    },
    {
      product: "GitHub Releases",
      usedBy: "Download buttons",
      neededOutsideRepo:
        "A public latest release and a static BranchMaster.dmg asset for direct macOS downloads.",
      expectedSource:
        "GitHub release assets produced outside the website code.",
    },
    {
      product: "GitHub repository",
      usedBy: "GitHub buttons and footer link",
      neededOutsideRepo: "Public repository availability.",
      expectedSource: "https://github.com/glassdevtools/branchmaster.",
    },
    {
      product: "Next.js hosting",
      usedBy: "Public website deployment",
      neededOutsideRepo:
        "Production project configuration, root directory set to website, and the PostHog public token.",
      expectedSource: "Vercel or another Next.js host.",
    },
  ],
  features: [
    {
      feature: "View marketing page",
      stateChanges: [
        "Renders nav, hero, product screenshot, features, questions, FAQ, bottom CTA, and footer.",
        "Responsive CSS changes layout for smaller screens without changing the section set.",
      ],
      backendResponses: [
        "Next.js serves the page and optimized static assets.",
        "PostHog may capture pageview and pageleave events.",
      ],
    },
    {
      feature: "Click Download",
      stateChanges: [
        "No in-page modal opens.",
        "The browser navigates to the current download href.",
        "download_app_clicked is captured with app_version, surface website, and button_location.",
      ],
      backendResponses: [
        "GitHub serves the latest release page or BranchMaster.dmg.",
        "PostHog receives the click event if the client is configured.",
      ],
    },
    {
      feature: "Auto-detect download platform",
      stateChanges: [
        "Initial href is the generic latest release page.",
        "macOS sets the href to BranchMaster.dmg.",
        "Windows keeps the generic href until Windows assets are published.",
        "Unsupported, failed, server, or iPad-like macOS detection keeps the generic href.",
      ],
      backendResponses: [
        "No backend request is made by detection itself.",
        "The selected href points to GitHub only when clicked.",
      ],
    },
    {
      feature: "Click GitHub",
      stateChanges: [
        "Tracked GitHub buttons navigate to the repo and capture github_clicked.",
        "The footer GitHub anchor navigates to the repo without the ClientGithubLink wrapper.",
      ],
      backendResponses: [
        "GitHub serves the repository page.",
        "PostHog receives tracked button events for nav, hero, and CTA.",
      ],
    },
    {
      feature: "Open FAQ item",
      stateChanges: [
        "The selected details element changes from closed to open.",
        "Other FAQ items are not forced closed.",
      ],
      backendResponses: ["No backend response."],
    },
  ],
  decisions: [
    {
      decision: "Unknown download platforms stay on the GitHub Release page.",
      reason:
        "The release page is the only generic place that can show every available asset without guessing.",
      carryOver:
        "Future Linux or ARM downloads should add explicit platform states rather than changing the generic fallback.",
    },
    {
      decision: "Download and GitHub button location is a state variable.",
      reason:
        "The UI behavior is the same, but analytics treats nav, hero, and CTA differently.",
      carryOver:
        "Any new tracked website button should add a location value or reuse an existing one intentionally.",
    },
    {
      decision: "FAQ expansion is browser state.",
      reason:
        "The page uses native details elements and does not synchronize FAQ state through React.",
      carryOver:
        "If later FAQ analytics or single-open behavior is needed, this should become explicit component state.",
    },
  ],
};
