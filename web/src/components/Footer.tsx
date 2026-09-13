import { footerCopy } from "../design/copy";

const GITHUB_URL = "https://github.com/ocariaso";
const CONTACT_EMAIL = "ormincariasojr@gmail.com";
const CONTACT_URL = `mailto:${CONTACT_EMAIL}?subject=CHORD%20bug%20report`;
const KOFI_URL = "https://ko-fi.com/ormincariaso";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.17c0 4.47 2.87 8.26 6.84 9.6.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.36-3.37-1.36-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.47.1 2.73.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.17C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x="8" y="7" width="8" height="11" rx="4" />
      <path d="M8 10H4M20 10h-4M8 15H3M21 15h-5M10 7V5a2 2 0 0 1 4 0v2" strokeLinecap="round" />
    </svg>
  );
}

function KofiIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M4 5h13v9a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V5z" />
      <path d="M17 8h1.5a2.5 2.5 0 0 1 0 5H17" strokeLinecap="round" />
    </svg>
  );
}

/** The page footer. The template has none; it is kept by decision, built from Nocturne's icon buttons and the template's hint. */
export function Footer() {
  return (
    <footer className="flex flex-col items-center" style={{ gap: "var(--space-1)", padding: "0 var(--space-8) var(--space-8)" }}>
      <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-icon"
          aria-label={footerCopy.github}
          title={footerCopy.github}
        >
          <GitHubIcon />
        </a>
        <a href={CONTACT_URL} className="btn btn-ghost btn-icon" aria-label={footerCopy.reportBug} title={footerCopy.reportBug}>
          <BugIcon />
        </a>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-icon"
          aria-label={footerCopy.kofi}
          title={footerCopy.kofi}
        >
          <KofiIcon />
        </a>
      </div>
      <span className="ch-hint">{footerCopy.copyright(new Date().getFullYear(), __APP_VERSION__)}</span>
    </footer>
  );
}
