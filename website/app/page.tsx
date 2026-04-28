import Image from "next/image";
import { ClientDownloadLink } from "./client-download-link";
import originalLobsterTreeIcon from "../src/assets/original-lobster-tree-icon.png";

const repoUrl = "https://github.com/glassdevtools/molttree";

const HomePage = () => {
  return (
    <main className="page">
      <nav className="topNav" aria-label="Primary">
        <a className="wordmark" href="/">
          <Image src={originalLobsterTreeIcon} alt="" aria-hidden="true" />
          <span className="wordmarkText">MoltTree</span>
        </a>
      </nav>

      <section className="hero" aria-labelledby="hero-title">
        <div className="heroArt">
          <Image src={originalLobsterTreeIcon} alt="MoltTree icon" preload />
        </div>

        <h1 id="hero-title">MoltTree</h1>
        <p className="description">
          Browse Codex conversations next to the repositories, branches, and
          commits that produced them.
        </p>
        <div className="hero__actions">
          <ClientDownloadLink
            className="button button--primary"
            ariaLabel="Download"
          >
            Download
          </ClientDownloadLink>
          <a className="button button--secondary" href={repoUrl}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0.5C5.65 0.5 0.5 5.65 0.5 12C0.5 17.1 3.8 21.42 8.38 22.95C8.95 23.05 9.16 22.7 9.16 22.4C9.16 22.12 9.15 21.21 9.14 20.24C5.94 20.94 5.26 18.88 5.26 18.88C4.74 17.55 3.98 17.2 3.98 17.2C2.94 16.49 4.06 16.5 4.06 16.5C5.22 16.58 5.83 17.69 5.83 17.69C6.86 19.45 8.52 18.94 9.18 18.65C9.28 17.91 9.58 17.4 9.91 17.11C7.35 16.82 4.66 15.83 4.66 11.42C4.66 10.16 5.11 9.13 5.85 8.32C5.73 8.03 5.33 6.86 5.96 5.27C5.96 5.27 6.93 4.96 9.13 6.45C10.05 6.19 11.03 6.07 12 6.06C12.97 6.07 13.95 6.19 14.87 6.45C17.07 4.96 18.04 5.27 18.04 5.27C18.67 6.86 18.27 8.03 18.15 8.32C18.89 9.13 19.34 10.16 19.34 11.42C19.34 15.84 16.64 16.81 14.08 17.1C14.49 17.46 14.86 18.16 14.86 19.24C14.86 20.79 14.85 22.04 14.85 22.4C14.85 22.71 15.06 23.06 15.64 22.95C20.21 21.42 23.5 17.1 23.5 12C23.5 5.65 18.35 0.5 12 0.5Z" />
            </svg>
            GitHub
          </a>
        </div>
      </section>
    </main>
  );
};

export default HomePage;
