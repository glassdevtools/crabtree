import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const siteTitle = "MoltTree";
const siteDescription =
  "Your Codex chats, worktrees, and branches, all in one place.";

export const metadata: Metadata = {
  metadataBase: new URL("https://molttree.app"),
  title: siteTitle,
  description: siteDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: "/",
    siteName: siteTitle,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
};

type RootLayoutProps = {
  children: ReactNode;
};

const RootLayout = ({ children }: RootLayoutProps) => {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
