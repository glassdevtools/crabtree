import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const siteTitle = "Crabtree";
const siteDescription = "Easily merge your worktrees together.";

export const metadata: Metadata = {
  metadataBase: new URL("https://crabtree.app"),
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
