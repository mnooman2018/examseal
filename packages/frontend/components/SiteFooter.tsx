import Link from "next/link";
import { SITE, TEAM_NAMES } from "@/lib/site";
import { registry } from "@/lib/registry";
import { shortHex } from "@/lib/format";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-row">
        <nav className="footer-links" aria-label="Footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href={SITE.contractUrl} target="_blank" rel="noreferrer">
            Verified contract <span className="mono">{shortHex(registry.address)}</span> on MSTScan
          </a>
          <a href={SITE.repo} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </nav>
        <div className="muted small">
          Built on MST Blockchain. Demo on MST Testnet only. Team: {TEAM_NAMES}.
        </div>
      </div>
    </footer>
  );
}
