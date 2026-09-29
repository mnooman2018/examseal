"use client";

// D12 dashboard shell: fixed left sidebar, top bar (exam picker, latest block, wallet), footer.
// Layout and read-only display only; the wallet button and chain switch are the existing ones.

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccount, useSwitchChain } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { AddressLink } from "./TxLink";
import { mstTestnet } from "@/lib/chains";
import { registry } from "@/lib/registry";
import { parseExamId, useLatestExamId } from "@/hooks/useExam";
import { useChainTime } from "@/hooks/useChainTime";

type NavItem = { label: string; href: (exam?: bigint) => string; active: (path: string) => boolean };

const NAV: NavItem[] = [
  { label: "Control room", href: (e) => (e ? `/?exam=${e}` : "/"), active: (p) => p === "/" },
  { label: "Custodian", href: () => "/custodian", active: (p) => p.startsWith("/custodian") },
  { label: "Centre", href: () => "/centre", active: (p) => p.startsWith("/centre") },
  { label: "Digital", href: () => "/digital", active: (p) => p.startsWith("/digital") },
  { label: "Trace", href: (e) => (e ? `/trace?exam=${e}` : "/trace"), active: (p) => p.startsWith("/trace") },
  { label: "Exam timeline", href: (e) => (e ? `/exam/${e}` : "/"), active: (p) => p.startsWith("/exam/") },
];

/** The exam in context: /exam/[id], else ?exam=, else the latest on the registry. */
function useCurrentExam(): bigint | undefined {
  const path = usePathname();
  const search = useSearchParams();
  const latest = useLatestExamId();
  const fromPath = path.startsWith("/exam/") ? parseExamId(path.split("/")[2]) : undefined;
  return fromPath ?? parseExamId(search.get("exam")) ?? (latest.data && latest.data > 0n ? latest.data : undefined);
}

function SideNav() {
  const path = usePathname();
  const exam = useCurrentExam();
  return (
    <nav className="side-nav" aria-label="Main">
      {NAV.map((n) => (
        <Link key={n.label} href={n.href(exam)} className={`side-link ${n.active(path) ? "side-link-active" : ""}`}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

function ExamPicker() {
  const router = useRouter();
  const path = usePathname();
  const current = useCurrentExam();
  const [draft, setDraft] = useState("");
  return (
    <form
      className="topbar-exam"
      onSubmit={(e) => {
        e.preventDefault();
        const id = parseExamId(draft.trim());
        if (!id) return;
        setDraft("");
        router.push(path.startsWith("/exam/") ? `/exam/${id}` : `${path}?exam=${id}`);
      }}
    >
      <label className="topbar-label" htmlFor="exam-picker">
        Exam
      </label>
      <input
        id="exam-picker"
        inputMode="numeric"
        placeholder={current ? `#${current}` : "#"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Exam number"
      />
      <button type="submit">Open</button>
    </form>
  );
}

function LatestBlock() {
  const { blockNumber, error } = useChainTime();
  return (
    <div className="topbar-block" title="Latest MST Testnet block (polled every 3 s)">
      <span className="topbar-label">Block</span>
      <span className="mono">{error ? "unreachable" : blockNumber !== undefined ? `#${blockNumber.toString()}` : "…"}</span>
    </div>
  );
}

function WrongChain() {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  if (!isConnected || chainId === mstTestnet.id) return null;
  return (
    <div className="banner banner-warn shell-banner">
      <div>
        Your wallet is on chain {chainId}. ExamSeal runs on MST Testnet (chain {mstTestnet.id}).
      </div>
      <button type="button" disabled={isPending} onClick={() => switchChain({ chainId: mstTestnet.id })}>
        Switch to MST Testnet
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="wordmark">
          EXAMSEAL
        </Link>
        <div className="sidebar-sub mono">MST TESTNET</div>
        <Suspense fallback={null}>
          <SideNav />
        </Suspense>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <Suspense fallback={null}>
            <ExamPicker />
          </Suspense>
          <LatestBlock />
          <div className="topbar-spacer" />
          <ConnectButton />
        </header>
        <WrongChain />
        <div className="shell-content">{children}</div>
        <footer className="site-footer mono">
          <strong>Built on MST Blockchain</strong>
          <span>chain {mstTestnet.id}</span>
          <span>
            registry <AddressLink address={registry.address} />
          </span>
        </footer>
      </div>
    </div>
  );
}
