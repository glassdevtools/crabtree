import posthog from "posthog-js/dist/module.no-external";
import packageInfo from "../../package.json";

const POSTHOG_PROJECT_TOKEN =
  "phc_rFdSeJdgESyPtJWuULeF8uSHDS87cnGRMAYEW3fZUKN5";
const POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_UI_HOST = "https://us.posthog.com";
const PRIVATE_MODE_STORAGE_KEY = "molttree.privateMode";

type DesktopAnalyticsEventName =
  | "branch_created"
  | "branch_deleted"
  | "branch_dragged"
  | "branch_merged"
  | "branch_moved"
  | "branches_pulled"
  | "branches_pushed"
  | "change_summary_opened"
  | "changes_committed"
  | "chat_opened"
  | "codex_chats_filter_changed"
  | "github_clicked"
  | "head_switched"
  | "path_launcher_changed"
  | "repo_opened"
  | "repo_selected"
  | "tag_created"
  | "tag_deleted";

type AnalyticsProperties = { [key: string]: string | number | boolean };

let didInitializeAnalytics = false;
let analyticsIdentityPromise: Promise<void> | null = null;

const applyAnalyticsPrivateMode = (isPrivateMode: boolean) => {
  if (isPrivateMode) {
    analyticsIdentityPromise = null;
    posthog.reset(true);
    posthog.opt_out_capturing();
    return;
  }

  posthog.opt_in_capturing({
    captureEventName: false,
  });
  analyticsIdentityPromise = (async () => {
    const analyticsInstallId = await window.molttree.readAnalyticsInstallId();

    if (readIsAnalyticsPrivateMode()) {
      return;
    }

    posthog.identify(analyticsInstallId, {
      app_version: packageInfo.version,
    });
  })().catch((error) => {
    console.error("Failed to identify analytics install.", error);
  });
};

export const readIsAnalyticsPrivateMode = () => {
  return window.localStorage.getItem(PRIVATE_MODE_STORAGE_KEY) === "true";
};

export const initializeAnalytics = () => {
  if (didInitializeAnalytics) {
    return analyticsIdentityPromise ?? Promise.resolve();
  }

  didInitializeAnalytics = true;
  posthog.init(POSTHOG_PROJECT_TOKEN, {
    api_host: POSTHOG_HOST,
    ui_host: POSTHOG_UI_HOST,
    defaults: "2026-01-30",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    disable_persistence: true,
    disable_scroll_properties: true,
    disable_session_recording: true,
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    person_profiles: "identified_only",
    save_campaign_params: false,
    save_referrer: false,
    advanced_disable_flags: true,
  });
  applyAnalyticsPrivateMode(readIsAnalyticsPrivateMode());

  return analyticsIdentityPromise ?? Promise.resolve();
};

export const setAnalyticsPrivateMode = (isPrivateMode: boolean) => {
  window.localStorage.setItem(
    PRIVATE_MODE_STORAGE_KEY,
    isPrivateMode ? "true" : "false",
  );
  void initializeAnalytics();
  applyAnalyticsPrivateMode(isPrivateMode);
};

export const trackDesktopAction = ({
  eventName,
  properties,
}: {
  eventName: DesktopAnalyticsEventName;
  properties: AnalyticsProperties;
}) => {
  if (readIsAnalyticsPrivateMode()) {
    return;
  }

  void (async () => {
    await initializeAnalytics();

    if (readIsAnalyticsPrivateMode()) {
      return;
    }

    posthog.capture(eventName, {
      surface: "desktop",
      app_version: packageInfo.version,
      ...properties,
    });
  })().catch((error) => {
    console.error("Failed to track desktop action.", error);
  });
};
