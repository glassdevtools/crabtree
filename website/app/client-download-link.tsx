"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import posthog from "posthog-js";
import {
  CLIENT_DOWNLOAD_PAGE_PATH,
  getAutoDetectedDownloadUrl,
} from "../src/clientDownloadUrls";

export const ClientDownloadLink = ({
  ariaLabel,
  children,
  className,
  location,
}: {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  location: "nav" | "hero" | "cta";
}) => {
  const [href, setHref] = useState(CLIENT_DOWNLOAD_PAGE_PATH);

  useEffect(() => {
    let didCancel = false;

    const setAutoDetectedHref = async () => {
      let autoDetectedDownloadUrl: string | null = null;
      try {
        autoDetectedDownloadUrl = await getAutoDetectedDownloadUrl();
      } catch {
        return;
      }

      if (didCancel || autoDetectedDownloadUrl === null) {
        return;
      }

      setHref(autoDetectedDownloadUrl);
    };

    void setAutoDetectedHref();

    return () => {
      didCancel = true;
    };
  }, []);

  const handleClick = () => {
    posthog.capture("download_clicked", {
      location,
      download_url: href,
      platform_detected: href !== CLIENT_DOWNLOAD_PAGE_PATH,
    });
  };

  return (
    <a className={className} href={href} aria-label={ariaLabel} onClick={handleClick}>
      {children}
    </a>
  );
};
