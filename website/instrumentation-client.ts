import posthog from "posthog-js/dist/module.no-external";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  autocapture: true,
  capture_pageview: "history_change",
  capture_pageleave: true,
  capture_dead_clicks: true,
  capture_exceptions: true,
  capture_heatmaps: true,
  disable_session_recording: true,
  save_campaign_params: true,
  save_referrer: true,
});
