import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custodian console",
  description:
    "Load a custodian file and release your key pieces for every exam centre. The contract accepts pieces only at or after the release time.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
