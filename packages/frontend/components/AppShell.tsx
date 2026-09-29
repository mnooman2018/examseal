"use client";

// D12/D13 dashboard shell: left sidebar with line icons, top bar with pill controls (exam picker, latest
// block, wallet), footer. Layout and read-only display only; the wallet button and chain switch are the
// existing ones.

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

type IconName = "grid" | "key" | "building" | "monitor" | "search" | "clock" | "cube" | "pulse" | "bars" | "shield";

/** Small line icons (24×24, stroke = currentColor). */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "key":
      return (
        <svg {...common}>
          <circle cx="8" cy="15" r="4" />
          <path d="M11 12l9-9M17 6l2 2M15 8l2 2" />
        </svg>
      );
    case "building":
      return (
        <svg {...common}>
          <path d="M4 21V5l8-3 8 3v16" />
          <path d="M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M2 21h20" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "pulse":
      return (
        <svg {...common}>
          <path d="M3 12h4l2-5 4 10 2-5h6" />
        </svg>
      );
    case "bars":
      return (
        <svg {...common}>
          <path d="M5 20v-6M10 20V9M15 20v-9M20 20V4" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "cube":
      return (
        <svg {...common}>
          <path d="M12 2l9 5v10l-9 5-9-5V7z" />
          <path d="M3 7l9 5 9-5M12 12v10" />
        </svg>
      );
  }
}

type NavItem = { label: string; icon: IconName; href: (exam?: bigint) => string; active: (path: string) => boolean };

const NAV: NavItem[] = [
  { label: "Control Room", icon: "grid", href: (e) => (e ? `/?exam=${e}` : "/"), active: (p) => p === "/" },
  { label: "Custodian", icon: "key", href: () => "/custodian", active: (p) => p.startsWith("/custodian") },
  { label: "Centre", icon: "building", href: () => "/centre", active: (p) => p.startsWith("/centre") },
  { label: "Digital", icon: "monitor", href: () => "/digital", active: (p) => p.startsWith("/digital") },
  { label: "Trace", icon: "search", href: (e) => (e ? `/trace?exam=${e}` : "/trace"), active: (p) => p.startsWith("/trace") },
  { label: "Exam Timeline", icon: "clock", href: (e) => (e ? `/exam/${e}` : "/"), active: (p) => p.startsWith("/exam/") },
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
        <Link key={n.label} href={n.href(exam)} className={`side-link ${n.active(path) ? "side-link-active" : ""}`} aria-current={n.active(path) ? "page" : undefined}>
          <Icon name={n.icon} />
          <span>{n.label}</span>
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
      className="topbar-exam topbar-pill"
      onSubmit={(e) => {
        e.preventDefault();
        const id = parseExamId(draft.trim());
        if (!id) return;
        setDraft("");
        router.push(path.startsWith("/exam/") ? `/exam/${id}` : `${path}?exam=${id}`);
      }}
    >
      <Icon name="search" size={16} />
      <input
        id="exam-picker"
        inputMode="numeric"
        placeholder={current ? `Exam #${current}` : "Exam #"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Open exam number"
      />
      <button type="submit">Open</button>
    </form>
  );
}

function LatestBlock() {
  const { blockNumber, error } = useChainTime();
  return (
    <div className="topbar-block topbar-pill" title="Latest MST Testnet block (polled every 3 s)">
      <Icon name="cube" size={16} />
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
          <span className="wordmark-mark" aria-hidden />
          ExamSeal
        </Link>
        <div className="sidebar-sub">on MST Testnet</div>
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
        <footer className="site-footer">
          <span>
            <strong>Built on MST Blockchain</strong>
          </span>
          <span className="mono">
            chain {mstTestnet.id} · registry <AddressLink address={registry.address} />
          </span>
        </footer>
      </div>
    </div>
  );
}
