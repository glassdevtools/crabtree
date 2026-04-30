import Image from "next/image";
import { ClientDownloadLink } from "./client-download-link";
import { buttonVariants } from "@/components/ui/button";
import defaultAppIcon from "../src/assets/default-app-icon.png";
import productScreenshot from "../src/assets/product-screenshot.png";

const repoUrl = "https://github.com/glassdevtools/molttree";
const heroActionButtonClassName = "max-sm:w-full";
const downloadButtonClassName = "downloadButton";
const githubButtonClassName = "githubButton";
const featureItems = [
  {
    title: "Everything on a single page",
    descriptionLines: [
      <>
        View all your{" "}
        <span className="featureToken featureTokenWorktree">worktrees</span>,{" "}
        <span className="featureToken featureTokenBranch">branch tags</span>,
        and <span className="featureToken featureTokenChat">chats</span> in one
        place.
      </>,
    ],
  },
  {
    title: "Auto-sync",
    descriptionLines: [
      "Everything automatically stays in sync with Git and Codex, no refresh button needed.",
    ],
  },
  {
    title: "Git power tools",
    descriptionLines: [
      "Commit, branch, merge, push, and pull. No IDE needed. Access power tools like moving branch tags by simply dragging, and one-click merges without leaving the app or opening your IDE.",
    ],
  },
  {
    title: "Built-in safety checks",
    descriptionLines: [
      "We have strong automatic safety checks when you delete branches, switch HEAD, and more, to make sure you don't lose an important commit.",
    ],
  },
];
const questionItems = [
  <>
    Where are all my{" "}
    <span className="featureToken featureTokenWorktree">worktrees</span>?
  </>,
  <>
    Which <span className="featureToken featureTokenChat">chats</span> are on
    which <span className="featureToken featureTokenWorktree">worktrees</span>?
  </>,
  <>
    Which <span className="featureToken featureTokenBranch">branches</span> are
    on which <span className="featureToken featureTokenChat">chats</span>?
  </>,
  <>
    Which <span className="featureToken featureTokenWorktree">worktrees</span>{" "}
    have changes?
  </>,
  <>
    Which <span className="featureToken featureTokenChat">chats</span> have
    changes?
  </>,
  "And more...",
];

const GitHubIcon = () => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    data-icon="inline-start"
    style={{
      fill: "currentColor",
      flex: "0 0 auto",
      height: "1em",
      width: "1em",
    }}
  >
    <path d="M12 0.5C5.65 0.5 0.5 5.65 0.5 12C0.5 17.1 3.8 21.42 8.38 22.95C8.95 23.05 9.16 22.7 9.16 22.4C9.16 22.12 9.15 21.21 9.14 20.24C5.94 20.94 5.26 18.88 5.26 18.88C4.74 17.55 3.98 17.2 3.98 17.2C2.94 16.49 4.06 16.5 4.06 16.5C5.22 16.58 5.83 17.69 5.83 17.69C6.86 19.45 8.52 18.94 9.18 18.65C9.28 17.91 9.58 17.4 9.91 17.11C7.35 16.82 4.66 15.83 4.66 11.42C4.66 10.16 5.11 9.13 5.85 8.32C5.73 8.03 5.33 6.86 5.96 5.27C5.96 5.27 6.93 4.96 9.13 6.45C10.05 6.19 11.03 6.07 12 6.06C12.97 6.07 13.95 6.19 14.87 6.45C17.07 4.96 18.04 5.27 18.04 5.27C18.67 6.86 18.27 8.03 18.15 8.32C18.89 9.13 19.34 10.16 19.34 11.42C19.34 15.84 16.64 16.81 14.08 17.1C14.49 17.46 14.86 18.16 14.86 19.24C14.86 20.79 14.85 22.04 14.85 22.4C14.85 22.71 15.06 23.06 15.64 22.95C20.21 21.42 23.5 17.1 23.5 12C23.5 5.65 18.35 0.5 12 0.5Z" />
  </svg>
);

const HomePage = () => {
  return (
    <main className="page">
      <nav className="topNav" aria-label="Primary">
        <a className="wordmark" href="/">
          <Image src={defaultAppIcon} alt="" aria-hidden="true" />
          <span className="wordmarkText">
            <span className="wordmarkTextBase">MoltTree</span>
            <span className="wordmarkTextGradient" aria-hidden="true">
              MoltTree
            </span>
          </span>
        </a>
        <div className="topNavActions">
          <ClientDownloadLink
            className={buttonVariants({
              size: "sm",
              className: downloadButtonClassName,
            })}
            ariaLabel="Download"
          >
            Download
          </ClientDownloadLink>
          <a
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: githubButtonClassName,
            })}
            href={repoUrl}
          >
            <GitHubIcon />
            GitHub
          </a>
        </div>
      </nav>

      <section className="hero" aria-labelledby="hero-title">
        <div className="heroInner">
          <div className="heroIntro">
            <h1 className="heroTitle" id="hero-title">
              <span className="heroTitleIcon" aria-hidden="true">
                <Image src={defaultAppIcon} alt="" />
              </span>
              <span>MoltTree</span>
            </h1>
            <p className="heroSubtext">
              Your Codex worktrees, chats, and branches, all in one place.
            </p>
            <div className="hero__actions">
              <ClientDownloadLink
                className={buttonVariants({
                  size: "lg",
                  className: `${heroActionButtonClassName} ${downloadButtonClassName}`,
                })}
                ariaLabel="Download"
              >
                Download
              </ClientDownloadLink>
              <a
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: `${heroActionButtonClassName} ${githubButtonClassName}`,
                })}
                href={repoUrl}
              >
                <GitHubIcon />
                GitHub
              </a>
            </div>
          </div>

          <figure className="productPhoto">
            <Image
              src={productScreenshot}
              alt="MoltTree showing Codex chats, branch tags, worktrees, and Git history"
              preload
            />
          </figure>
        </div>
      </section>

      <section
        className="contentSection questionsSection"
        aria-labelledby="questions-title"
      >
        <div className="sectionInner">
          <div className="sectionHeader">
            <h2 id="questions-title">Answers questions like:</h2>
          </div>
          <ul className="questionList">
            {questionItems.map((questionItem, index) => (
              <li key={`question-${index}`}>{questionItem}</li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="contentSection featuresSection"
        aria-labelledby="features-title"
      >
        <div className="sectionInner">
          <div className="sectionHeader">
            <h2 id="features-title">Features</h2>
          </div>
          <ul className="bulletList">
            {featureItems.map((featureItem) => (
              <li key={featureItem.title}>
                <strong>{featureItem.title}</strong>
                {featureItem.descriptionLines.length === 0 ? null : (
                  <div className="bulletText">
                    {featureItem.descriptionLines.map(
                      (descriptionLine, index) => (
                        <p key={`${featureItem.title}-${index}`}>
                          {descriptionLine}
                        </p>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="bottomCta"
        aria-labelledby="cta-title"
        style={{
          alignItems: "center",
          background: "#ffffff",
          display: "flex",
          justifyContent: "center",
          margin: "112px auto",
          minHeight: "0",
          padding: "48px 24px",
          textAlign: "center",
        }}
      >
        <div
          className="bottomCtaInner"
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: "30px",
            margin: "0 auto",
            width: "min(980px, 100%)",
          }}
        >
          <h2
            id="cta-title"
            style={{
              color: "#101410",
              fontFamily:
                '"Arial Black", "Avenir Next", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontSize: "1.9rem",
              fontWeight: 900,
              letterSpacing: 0,
              lineHeight: 1.06,
              margin: "0 auto",
              maxWidth: "520px",
              textWrap: "balance",
            }}
          >
            A smarter way to manage your{" "}
            <span className="featureToken featureTokenWorktree">worktrees</span>
            .
          </h2>
          <div
            className="hero__actions bottomCtaActions"
            style={{
              alignItems: "center",
              flexDirection: "column",
              marginBottom: 0,
            }}
          >
            <ClientDownloadLink
              className={buttonVariants({
                size: "lg",
                className: `${heroActionButtonClassName} ${downloadButtonClassName}`,
              })}
              ariaLabel="Download"
            >
              Download
            </ClientDownloadLink>
            <a
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: `${heroActionButtonClassName} ${githubButtonClassName}`,
              })}
              href={repoUrl}
            >
              <GitHubIcon />
              GitHub
            </a>
          </div>
        </div>
      </section>

      <footer
        className="siteFooter"
        style={{
          alignItems: "center",
          borderTop: "1px solid #e5eadf",
          display: "flex",
          gap: "18px",
          justifyContent: "space-between",
          padding: "22px 24px",
        }}
      >
        <p
          style={{
            color: "#101410",
            fontSize: "0.9rem",
            fontWeight: 600,
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          © 2026 Glass Devtools, Inc. - All rights reserved.
        </p>
        <a
          href={repoUrl}
          aria-label="GitHub"
          style={{
            alignItems: "center",
            border: "1px solid #d6ddd2",
            borderRadius: "8px",
            color: "#101410",
            display: "inline-flex",
            height: "36px",
            justifyContent: "center",
            width: "36px",
          }}
        >
          <GitHubIcon />
        </a>
      </footer>
    </main>
  );
};

export default HomePage;
