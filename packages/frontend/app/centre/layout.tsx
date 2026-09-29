import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exam centre",
  description:
    "Load a centre key file, check the released pieces and the variant commitment, and rebuild the paper key in this browser.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
