<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the MoltTree website. PostHog is initialized via `instrumentation-client.ts` (the Next.js 15.3+ recommended approach) with a reverse proxy through Next.js rewrites, automatic exception capture, and debug mode in development. Two client-side events are tracked across the landing page: `download_clicked` on every download button, and `github_clicked` on every GitHub link — each tagged with a `location` property so you can see which part of the page converts best.

| Event | Description | File |
|---|---|---|
| `download_clicked` | User clicks a download button. Properties: `location` (nav/hero/cta), `download_url`, `platform_detected`. | `app/client-download-link.tsx` |
| `github_clicked` | User clicks a GitHub link. Properties: `location` (nav/hero/cta/footer). | `app/client-github-link.tsx` |

## Files changed

- **`instrumentation-client.ts`** *(new)* — PostHog client-side init with reverse proxy, exception capture, and debug mode.
- **`next.config.ts`** — Added `/ingest` rewrites for PostHog reverse proxy and `skipTrailingSlashRedirect: true`.
- **`app/client-download-link.tsx`** — Added `location` prop and `download_clicked` event capture on click.
- **`app/client-github-link.tsx`** *(new)* — Client component wrapping GitHub links to capture `github_clicked` with location.
- **`app/page.tsx`** — Replaced plain `<a>` GitHub links with `ClientGithubLink`; added `location` props to all `ClientDownloadLink` instances.
- **`.env.local`** — Added `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST`.

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics:** https://us.posthog.com/project/403870/dashboard/1528023
- **Download clicks over time:** https://us.posthog.com/project/403870/insights/v0Ir9uTe
- **Download clicks by location:** https://us.posthog.com/project/403870/insights/Szlalszl
- **GitHub clicks over time:** https://us.posthog.com/project/403870/insights/mUZlo1XB
- **Download vs GitHub clicks:** https://us.posthog.com/project/403870/insights/27vz9oqW
- **Download conversion funnel (pageview → download):** https://us.posthog.com/project/403870/insights/00daJ7fb

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
