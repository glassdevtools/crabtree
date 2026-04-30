import Image from "next/image";
import { FiDownload } from "react-icons/fi";
import { IoLogoGithub } from "react-icons/io";
import { ClientDownloadLink } from "./client-download-link";
import { ClientGithubLink } from "./client-github-link";
import { buttonVariants } from "@/components/ui/button";
import defaultAppIcon from "../src/assets/default-app-icon.png";
import productScreenshot from "../src/assets/product-screenshot.png";

const repoUrl = "https://github.com/glassdevtools/molttree";
const ctaDownloadButtonClassName = "ctaButton ctaButtonDownload";
const ctaGithubButtonClassName = "ctaButton ctaButtonGithub";
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
      "Commit, branch, merge, push, and pull. No IDE needed. Access power tools like one-click merges, and moving branch tags by simply dragging.",
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

const HomePage = () => {
  return (
    <main className="page">
      <nav className="topNav" aria-label="Primary">
        <a className="wordmark group/logo" href="/">
          <Image
            className="transition-[filter] duration-500 ease-out"
            src={defaultAppIcon}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="wordmarkText">
            <span className="wordmarkTextBase">MoltTree</span>
            <span
              className="wordmarkTextGradient transition-opacity duration-500 ease-out"
              aria-hidden="true"
            >
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
            location="nav"
          >
            Download
            <FiDownload aria-hidden="true" data-icon="inline-end" />
          </ClientDownloadLink>
          <ClientGithubLink
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: githubButtonClassName,
            })}
            href={repoUrl}
            location="nav"
          >
            GitHub
            <IoLogoGithub aria-hidden="true" data-icon="inline-end" />
          </ClientGithubLink>
        </div>
      </nav>

      <section className="hero" aria-labelledby="hero-title">
        <div className="heroInner">
          <div className="heroIntro">
            <h1 className="heroTitle" id="hero-title">
              <span className="heroTitleIcon" aria-hidden="true">
                <Image src={defaultAppIcon} alt="" draggable={false} />
              </span>
              <span>MoltTree</span>
            </h1>
            <p className="heroSubtext">
              Your Codex chats, worktrees, and branches, all in one place.
            </p>
            <div className="hero__actions">
              <ClientDownloadLink
                className={ctaDownloadButtonClassName}
                ariaLabel="Download"
                location="hero"
              >
                <span>Download</span>
                <FiDownload aria-hidden="true" />
              </ClientDownloadLink>
              <ClientGithubLink
                className={ctaGithubButtonClassName}
                href={repoUrl}
                location="hero"
              >
                <span>GitHub</span>
                <IoLogoGithub aria-hidden="true" />
              </ClientGithubLink>
            </div>
          </div>

          <figure className="productPhoto">
            <Image
              src={productScreenshot}
              alt="MoltTree showing Codex chats, branch tags, worktrees, and Git history"
              preload
              draggable={false}
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
            <h2 id="questions-title">Answer questions like:</h2>
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

      <section className="bottomCta" aria-labelledby="cta-title">
        <div className="bottomCtaInner">
          <h2 id="cta-title">Save time in Codex</h2>
          <p>
            There&apos;s a better way to manage your branches and worktrees.
          </p>
          <div className="hero__actions bottomCtaActions">
            <ClientDownloadLink
              className={ctaDownloadButtonClassName}
              ariaLabel="Download"
              location="cta"
            >
              <span>Download</span>
              <FiDownload aria-hidden="true" />
            </ClientDownloadLink>
            <ClientGithubLink
              className={ctaGithubButtonClassName}
              href={repoUrl}
              location="cta"
            >
              <span>GitHub</span>
              <IoLogoGithub aria-hidden="true" />
            </ClientGithubLink>
          </div>
        </div>
      </section>

      <footer className="siteFooter">
        <Image
          className="siteFooterIcon"
          src={defaultAppIcon}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <p>&copy; 2026 Glass Devtools, Inc.</p>
        <a href={repoUrl} aria-label="GitHub">
          <IoLogoGithub aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
};

export default HomePage;
