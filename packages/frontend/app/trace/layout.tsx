import type { Metadata } from "next";

// /trace is a client page, so its metadata lives here (same pattern as the other routes).
// With the root template "%s | ExamSeal" the tab reads "Trace a leak | ExamSeal".
export const metadata: Metadata = {
  title: "Trace a leak",
  description:
    "Trace a leaked exam paper to its centre, and for digital exams its seat, from a photo or pasted text. AI only transcribes; the match is deterministic and runs in this browser.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
