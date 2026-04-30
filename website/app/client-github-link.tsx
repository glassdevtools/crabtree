"use client";

import type { ReactNode } from "react";
import {
  trackWebsiteGithubClicked,
  type WebsiteButtonLocation,
} from "../src/analytics";

export const ClientGithubLink = ({
  children,
  className,
  ariaLabel,
  href,
  location,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  href: string;
  location: WebsiteButtonLocation;
}) => {
  const handleClick = () => {
    trackWebsiteGithubClicked({
      buttonLocation: location,
    });
  };

  return (
    <a
      className={className}
      href={href}
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      {children}
    </a>
  );
};
