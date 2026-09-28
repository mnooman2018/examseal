"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useSwitchChain } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { mstTestnet } from "@/lib/chains";
import { registry } from "@/lib/registry";
import { AddressLink } from "./TxLink";

const NAV = [
  { href: "/", label: "Control room" },
  { href: "/custodian", label: "Custodian" },
  { href: "/centre", label: "Centre" },
  { href: "/trace", label: "Trace" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const wrongChain = isConnected && chainId !== mstTestnet.id;

  return (
    <header className="site-header">
      <div className="site-header-row">
        <Link href="/" className="brand">
          EXAMSEAL
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? "nav-active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <ConnectButton />
      </div>
      <div className="site-subrow muted">
        MST Testnet · registry <AddressLink address={registry.address} />
      </div>
      {wrongChain && (
        <div className="banner banner-warn">
          <div>Your wallet is on chain {chainId}. ExamSeal runs on MST Testnet (chain {mstTestnet.id}).</div>
          <button type="button" disabled={isPending} onClick={() => switchChain({ chainId: mstTestnet.id })}>
            Switch to MST Testnet
          </button>
        </div>
      )}
    </header>
  );
}
