import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What data the ExamSeal demo handles: files stay in your browser, trace photos go to Google Gemini (Groq as fallback), and blockchain data is public.",
};

const UPDATED = "29 September 2026";

export default function PrivacyPage() {
  return (
    <main className="legal">
      <div className="eyebrow">Last updated {UPDATED}</div>
      <h1>Privacy</h1>
      <p>
        This page describes what the ExamSeal demo does with data, based on its source code. The site has no accounts, no sign-up, and does
        not ask for your name or email address.
      </p>

      <section className="panel">
        <h2>1. Key files and other secret files</h2>
        <p>
          Custodian files, centre key files, <span className="mono">reveal.secret.json</span>, the codebook and the master paper are read by
          your browser into the memory of the open tab. They are not uploaded to our server or anywhere else, and they are not saved to
          cookies, local storage or any other browser storage. Reloading or closing the tab forgets them. Decryption of a centre&apos;s paper
          happens in your browser.
        </p>
        <p>
          On the computer-based exam page, the seat number you enter is used only in your browser to show that seat&apos;s copy. Answers are
          not recorded.
        </p>
      </section>

      <section className="panel">
        <h2>2. Photos on the trace page</h2>
        <ul>
          <li>
            Before anything is sent, your browser resizes the photo to at most 1600 pixels on its longest side and re-encodes it as a JPEG.
            This removes camera and location (GPS) metadata.
          </li>
          <li>
            The resized photo is sent to our server route <span className="mono">/api/extract</span>. That route forwards it to{" "}
            <strong>Google Gemini</strong> (Gemini API) to transcribe the printed text. If Gemini fails and a Groq key is configured on the
            server, the same photo is sent to <strong>Groq</strong> as a fallback. No other provider is used.
          </li>
          <li>
            Only the photo is sent. The codebook, key files and exam data are never sent. Matching the transcription to a centre happens in
            your browser.
          </li>
          <li>
            Our route does not save the photo or the transcription to disk or to a database, and does not log them. It returns the
            transcription to your browser and keeps nothing.
          </li>
          <li>
            Google and Groq receive the photo and handle it under their own terms, which may allow them to keep or use it. We do not control
            that. Do not upload photos that show people, names or other personal information. See the{" "}
            <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">
              Gemini API terms
            </a>{" "}
            and the{" "}
            <a href="https://groq.com/privacy-policy/" target="_blank" rel="noreferrer">
              Groq privacy policy
            </a>
            .
          </li>
          <li>
            If the exam authority records evidence, only a hash of the evidence report is written to MST Testnet. The report itself, and the
            photo, are not put on-chain or stored by us.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>3. Blockchain data is public</h2>
        <p>
          Wallet addresses and transactions on MST Testnet are public by design. Anyone can see them on MSTScan, and they cannot be deleted.
          This includes every exam, commitment, encrypted paper copy, sealed key piece, release, evidence hash, revocation and revealed
          fingerprint. When you sign a transaction, your wallet address is permanently linked to it.
        </p>
        <p>
          To show chain data, your browser sends read requests through our route <span className="mono">/api/rpc/testnet</span>, which
          forwards them to the public MST Testnet RPC. We do not store these requests. Your private key stays in your wallet extension and is
          never sent to this site.
        </p>
      </section>

      <section className="panel">
        <h2>4. Cookies, analytics and browser storage</h2>
        <p>
          The site sets no cookies and includes no analytics, tracking or advertising scripts. Fonts are served from this site, so pages make
          no requests to Google Fonts. The wallet library used by the site (wagmi) keeps your wallet connection state in your browser&apos;s
          local storage, under keys that start with <span className="mono">wagmi.</span>: the last wallet type you connected, your connected
          address and the chain ID, so the page can reconnect. This stays in your browser and is not sent to us. You can remove it by
          clearing this site&apos;s data in your browser. Your wallet extension may store its own data under its own policy.
        </p>
      </section>

      <section className="panel">
        <h2>5. Hosting</h2>
        <p>
          The site is hosted on Vercel. Like any web host, Vercel may keep standard request logs, such as IP address, time and the page
          requested, under its own privacy policy.
        </p>
      </section>

      <section className="panel">
        <h2>6. Contact</h2>
        <p>
          Questions or problems: open an issue at{" "}
          <a href={SITE.repo} target="_blank" rel="noreferrer">
            {SITE.repo.replace("https://", "")}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
