"use client";

import type { ReactNode } from "react";
import posthog from "posthog-js";

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
  location: "nav" | "hero" | "cta" | "footer";
}) => {
  const handleClick = () => {
    posthog.capture("github_clicked", {
      location,
    });
  };

  return (
    <a className={className} href={href} aria-label={ariaLabel} onClick={handleClick}>
      {children}
    </a>
  );
};
