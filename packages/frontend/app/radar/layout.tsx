import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leak radar",
  description: "Live feed of leak evidence and centre revocations across every exam on the ExamSeal registry, read from MST Testnet.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
