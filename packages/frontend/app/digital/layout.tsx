import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Computer-based exam",
  description:
    "Computer-based exam view: the centre unlocks its paper in this browser, then each candidate enters a seat number and sees their own traceable copy.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
