import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { registry } from "@/lib/registry";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "Terms of use for the ExamSeal hackathon demo. MST Testnet only, not for real exams, no warranty.",
};

const UPDATED = "29 September 2026";

export default function TermsPage() {
  return (
    <main className="prose">
      <div className="muted small">LAST UPDATED {UPDATED.toUpperCase()}</div>
      <h1>Terms of use</h1>

      <section>
        <h2>1. What this site is</h2>
        <p>
          ExamSeal is a demonstration built by {SITE.team.join(", ")} for the MST Blockchain × Newrro buildathon. It shows how exam
          papers can be sealed so that no single person can open them early, and how a leaked copy can be traced back to the centre
          it came from. It is a prototype, not a product or a service.
        </p>
      </section>

      <section>
        <h2>2. MST Testnet only</h2>
        <p>
          The site talks only to MST Testnet (chain ID 91562037), using the registry contract{" "}
          <a href={SITE.contractUrl} target="_blank" rel="noreferrer" className="mono break">
            {registry.address}
          </a>
          . Testnet tokens have no monetary value and cannot be exchanged for money. Do not send mainnet funds or real assets to any
          address shown on this site.
        </p>
      </section>

      <section>
        <h2>3. Not for real exams</h2>
        <p>
          Do not use this site to hold, release or investigate a real examination. Do not upload real question papers, student
          records, or photos that show people or personal information. The papers, centres and custodians shown here are demo data.
        </p>
      </section>

      <section>
        <h2>4. What the system does and does not claim</h2>
        <ul>
          <li>
            Release is threshold-based: in the demo exams, 3 of 5 custodians must release their pieces after the release time. If
            enough custodians to meet the threshold collude, they can open a paper early. ExamSeal makes that require several people
            and records every release on-chain.
          </li>
          <li>
            Tracing identifies the exam centre whose copy matches a leaked photo, not a specific person. Someone who deliberately
            rewrites and reshuffles a paper can defeat attribution.
          </li>
          <li>
            On-chain records are tamper-evident: once written, they cannot be silently changed. This does not make the system secure
            against every attack, and it has not been audited.
          </li>
          <li>
            The demo reuses one fixed codebook for every demo exam so that printed leak photos keep matching. A real deployment would
            give every exam its own secret codebook.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Transactions are permanent</h2>
        <p>
          Anything you sign with your wallet is sent to MST Testnet and becomes public and permanent. We cannot reverse, edit or delete
          a transaction. You are responsible for what you sign. We will never ask for your private key or seed phrase.
        </p>
      </section>

      <section>
        <h2>6. No warranty</h2>
        <p>
          The site and its code are provided as is, without warranty of any kind, express or implied, including fitness for a
          particular purpose. The site may be slow, unavailable, reset, or changed at any time, and testnet data may disappear. To the
          extent the law allows, the team is not liable for any loss arising from using the site or the code.
        </p>
      </section>

      <section>
        <h2>7. Other services</h2>
        <p>
          The site depends on services run by others: MST Testnet and its RPC, the MSTScan explorer, your wallet extension (BridgeKey
          or MetaMask), Vercel for hosting, and Google Gemini and Groq for reading text from photos on the trace page. Each has its own
          terms. See the <Link href="/privacy">privacy page</Link> for what data goes where.
        </p>
      </section>

      <section>
        <h2>8. Source code and contact</h2>
        <p>
          The source code is public at{" "}
          <a href={SITE.repo} target="_blank" rel="noreferrer">
            {SITE.repo.replace("https://", "")}
          </a>
          . To report a problem, open an issue in that repository.
        </p>
      </section>
    </main>
  );
}
