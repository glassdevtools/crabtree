import posthog from "posthog-js/dist/module.no-external";
import packageInfo from "../package.json";

export type WebsiteButtonLocation = "nav" | "hero" | "cta";

export const trackWebsiteDownloadAppClicked = ({
  buttonLocation,
}: {
  buttonLocation: WebsiteButtonLocation;
}) => {
  posthog.capture("download_app_clicked", {
    surface: "website",
    app_version: packageInfo.version,
    button_location: buttonLocation,
  });
};

export const trackWebsiteGithubClicked = ({
  buttonLocation,
}: {
  buttonLocation: WebsiteButtonLocation;
}) => {
  posthog.capture("github_clicked", {
    surface: "website",
    app_version: packageInfo.version,
    button_location: buttonLocation,
  });
};
