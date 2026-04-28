"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  CLIENT_DOWNLOAD_PAGE_PATH,
  getAutoDetectedDownloadUrl,
} from "../src/clientDownloadUrls";

export const ClientDownloadLink = ({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  className: string;
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

  return (
    <a className={className} href={href} aria-label={ariaLabel}>
      {children}
    </a>
  );
};
