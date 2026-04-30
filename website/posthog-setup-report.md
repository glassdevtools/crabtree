<wizard-report>
# PostHog post-wizard report

The wizard completed a PostHog integration for the MoltTree website. It has since been reduced to explicit anonymous event tracking only. PostHog is initialized via `instrumentation-client.ts` with a reverse proxy through Next.js rewrites. Autocapture, pageviews, pageleave, exception capture, heatmaps, surveys, persistence, person profiles, scroll properties, feature flags, and session recording are disabled in client config.

Two client-side events are tracked across the three paired landing-page buttons: `download_app_clicked` and `github_clicked`. Each event is tagged with `surface: "website"`, `app_version`, and `button_location` (`nav`, `hero`, or `cta`).

| Event                  | Description                                                                             | File                                               |
| ---------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `download_app_clicked` | User clicks a download button. Properties: `surface`, `app_version`, `button_location`. | `src/analytics.ts`, `app/client-download-link.tsx` |
| `github_clicked`       | User clicks a GitHub button. Properties: `surface`, `app_version`, `button_location`.   | `src/analytics.ts`, `app/client-github-link.tsx`   |

## Files changed

- **`instrumentation-client.ts`** _(new)_ — PostHog client-side init with reverse proxy and explicit event-only anonymous tracking.
- **`next.config.ts`** — Keeps the `/ingest` rewrite for event ingestion and `skipTrailingSlashRedirect: true`.
- **`src/analytics.ts`** — Defines the only website events and shared `button_location` values.
- **`app/client-download-link.tsx`** — Added `location` prop and `download_app_clicked` event capture on click.
- **`app/client-github-link.tsx`** _(new)_ — Client component wrapping GitHub links to capture `github_clicked` with location.
- **`app/page.tsx`** — Replaced the three paired GitHub links with `ClientGithubLink`; added `location` props to all `ClientDownloadLink` instances.
- **`.env.local`** — Added `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST`.

## Next steps

The wizard created these dashboard and insight links. They may still reference the old `download_clicked` event name and should be updated in PostHog to use `download_app_clicked`:

- **Dashboard — Analytics basics:** https://us.posthog.com/project/403870/dashboard/1528023
- **Download clicks over time:** https://us.posthog.com/project/403870/insights/v0Ir9uTe
- **Download clicks by location:** https://us.posthog.com/project/403870/insights/Szlalszl
- **GitHub clicks over time:** https://us.posthog.com/project/403870/insights/mUZlo1XB
- **Download vs GitHub clicks:** https://us.posthog.com/project/403870/insights/27vz9oqW
- **Download conversion funnel (pageview → download):** https://us.posthog.com/project/403870/insights/00daJ7fb

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
