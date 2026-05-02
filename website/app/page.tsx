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
    title: "Easily merge your worktrees",
    descriptionLines: [
      "Codex lets you easily spin up 100 worktrees, but merging them back together is hard. MoltTree was built to fix that. Commit, branch, merge, update main, and push without leaving the app.",
    ],
  },
  {
    title: "Everything on a single page",
    descriptionLines: [
      <>
        View all your{" "}
        <span className="featureToken featureTokenWorktree">worktrees</span>,{" "}
        <span className="featureToken featureTokenBranch">branches</span>,
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
      "Access power tools like one-click merges, simplified push and pull, and moving branches by simply dragging.",
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
    What <span className="featureToken featureTokenChat">chats</span> were
    merged?
  </>,
  <>
    What <span className="featureToken featureTokenWorktree">worktrees</span> do
    I have?
  </>,
  <>
    Which <span className="featureToken featureTokenBranch">branches</span> are
    on which <span className="featureToken featureTokenChat">chats</span>?
  </>,
  <>
    Which <span className="featureToken featureTokenChat">chats</span> are on
    which <span className="featureToken featureTokenWorktree">worktrees</span>?
  </>,
  <>
    Which <span className="featureToken featureTokenWorktree">worktrees</span>{" "}
    have changes?
  </>,
  "And more...",
];
const faqItems = [
  {
    question: "What are the core features?",
    answer:
      "MoltTree is a Git visualizer that shows you where your worktrees are (others don't), suggests actions to take like commit/merge/push, and shows you the commit each chat lives on.",
  },
  {
    question: "How should I use it?",
    answer: [
      "Start a bunch of worktrees in Codex. When you're ready to merge them, open MoltTree and switch to a branch by double clicking. Follow the suggestions in the Graph column to branch, commit, merge, and push.",
    ],
  },
  {
    question: "Does it only support Codex?",
    answer:
      "Yes, right now it relies on Codex to know about your repositories. In the future we may change this and show your chats from other tools.",
  },
];

const HomePage = () => {
  return (
    <main className="page">
      <nav className="topNav" aria-label="Primary">
        <a className="wordmark group/logo" href="/">
          <Image
            className="transition-[filter] duration-500 ease-out"
            src={defaultAppIcon}
            width={24}
            height={24}
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
                <Image
                  src={defaultAppIcon}
                  width={72}
                  height={72}
                  alt=""
                  draggable={false}
                />
              </span>
              <span>MoltTree</span>
            </h1>
            <p className="heroSubtext">
              Easily merge your Codex worktrees together. MoltTree gives you power tools to manage your chats, worktrees, and branches.
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
              alt="MoltTree app showing Codex chats, branches, worktrees, changed files, and Git history"
              sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1128px) calc(100vw - 48px), 1080px"
              preload
              placeholder="blur"
              draggable={false}
            />
          </figure>
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
        className="contentSection questionsSection"
        aria-labelledby="questions-title"
      >
        <div className="sectionInner">
          <div className="sectionHeader">
            <h2 id="questions-title">Answer questions like:</h2>
          </div>
          <ul className="questionList max-[760px]:!max-w-none">
            {questionItems.map((questionItem, index) => (
              <li
                className="max-[760px]:!whitespace-nowrap max-[760px]:!text-[clamp(0.85rem,3.5vw,1rem)] max-[760px]:!leading-[1.3]"
                key={`question-${index}`}
              >
                {questionItem}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="contentSection faqSection"
        aria-labelledby="faq-title"
      >
        <div className="sectionInner">
          <div className="sectionHeader">
            <h2 id="faq-title">FAQs</h2>
          </div>
          <ul className="faqList">
            {faqItems.map((faqItem) => (
              <li key={faqItem.question}>
                <details>
                  <summary>{faqItem.question}</summary>
                  {(typeof faqItem.answer === "string"
                    ? [faqItem.answer]
                    : faqItem.answer
                  ).map((answerParagraph) => (
                    <p key={answerParagraph}>{answerParagraph}</p>
                  ))}
                </details>
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
          width={52}
          height={52}
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
