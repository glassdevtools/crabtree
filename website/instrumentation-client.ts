import posthog from "posthog-js/dist/module.no-external";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
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
  person_profiles: "never",
  save_campaign_params: false,
  save_referrer: false,
  advanced_disable_flags: true,
});
