import Image from "next/image";
import { FiDownload } from "react-icons/fi";
import { IoLogoGithub } from "react-icons/io";
import { ClientDownloadLink } from "./client-download-link";
import { ClientGithubLink } from "./client-github-link";
import { buttonVariants } from "@/components/ui/button";
import codexChatIcon from "../src/assets/codex-chat-icon.png";
import defaultAppIcon from "../src/assets/default-app-icon.png";
import productScreenshot from "../src/assets/product-screenshot.png";

const repoUrl = "https://github.com/glassdevtools/branchmaster";
const ctaDownloadButtonClassName = "ctaButton ctaButtonDownload";
const ctaGithubButtonClassName = "ctaButton ctaButtonGithub";
const downloadButtonClassName = "downloadButton";
const githubButtonClassName = "githubButton";
const featureTokenClassName =
  "inline-flex h-[1.45em] items-center gap-1 rounded border px-[5px] align-middle text-[0.9em] font-[720] leading-none whitespace-nowrap";
const featureTokenBranchClassName = `${featureTokenClassName} border-[#acb9ca] bg-[#eaf1ff] text-[#162d54]`;
const featureTokenChatClassName = `${featureTokenClassName} border-[#d4dae3] bg-[#eef0f3] text-[#343a43]`;
const featureTokenAgentClassName = `${featureTokenClassName} border-[#d4dae3] bg-transparent text-[#343a43]`;

const AgentToken = () => (
  <span className={featureTokenAgentClassName}>
    {/* dot */}
    <span
      className="relative block size-[13px] shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8b929c]" />
    </span>
    <span>agents</span>
  </span>
);

const BranchToken = () => (
  <span className={featureTokenBranchClassName}>branches</span>
);

const ChatToken = () => (
  <span className={featureTokenChatClassName}>
    <Image
      className="block size-[13px] shrink-0"
      src={codexChatIcon}
      width={13}
      height={13}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
    <span>chats</span>
  </span>
);

const featureItems = [
  {
    title: "Easily merge your agents",
    descriptionLines: [
      "It's easy to spin up 100 AI worktrees, but merging them back together is hard. BranchMaster was built to fix that. Commit, branch, merge, update main, and push without leaving the app.",
    ],
  },
  {
    title: "Everything on a single page",
    descriptionLines: [
      <>
        View all your <BranchToken />, <ChatToken />, and <AgentToken />.
      </>,
    ],
  },
  {
    title: "Git power tools",
    descriptionLines: [
      "Access power tools like one-click merge, simplified push and pull, and moving branches by simply dragging.",
    ],
  },
  {
    title: "Auto-sync",
    descriptionLines: [
      "See where every chat lives on your Git tree. BranchMaster auto-detects your local chats and Git changes.",
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
  <>Which chats still need to be merged in?</>,
  <>
    Which <AgentToken /> have changes to review?
  </>,
  <>
    Which <ChatToken /> are on which <BranchToken />?
  </>,
];
const faqItems = [
  {
    question: "What are BranchMaster's core features?",
    answer: [
      "BranchMaster is a Git visualizer that also:",
      "- Shows you where your agents are.",
      "- Suggests actions to take like commit/merge/push.",
    ],
  },
  {
    question: "How should I use it?",
    answer: [
      "Start a bunch of parallel worktrees in Codex. When you're ready to merge them, open BranchMaster and switch to a branch by double clicking. Then follow the suggestions in the Graph column to branch, commit, merge, and push.",
    ],
  },
  {
    question: "What AI tools does it support?",
    answer: "Codex and OpenCode. We may support more tools in the future.",
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
            <span className="wordmarkTextBase">BranchMaster</span>
            <span
              className="wordmarkTextGradient transition-opacity duration-500 ease-out"
              aria-hidden="true"
            >
              BranchMaster
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
              <span>BranchMaster</span>
            </h1>
            <p className="heroSubtext">
              Easily merge your branches together. BranchMaster lets you manage
              your chats, branches, and worktrees in one place.
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
              alt="BranchMaster app showing Codex chats, branches, worktrees, changed files, and Git history"
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
