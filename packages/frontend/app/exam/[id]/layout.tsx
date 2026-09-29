import type { Metadata } from "next";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const id = /^\d+$/.test(params.id) ? params.id : "unknown";
  return {
    title: `Exam #${id}`,
    description: `Commitments, custodians, centres and the chain-of-custody timeline for exam #${id}, read from MST Testnet.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
