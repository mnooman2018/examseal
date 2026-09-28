import { explorerAddress, registry } from "./registry";

/** Public facts about the site, used in metadata, the footer, and the terms/privacy pages. */
export const SITE = {
  name: "ExamSeal",
  /** Canonical URL for link previews. Override with NEXT_PUBLIC_SITE_URL for another deployment. */
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://examseal-one.vercel.app",
  summary:
    "Exam papers that no single person can open early, and that trace any leak back to the centre it came from.",
  repo: "https://github.com/mnooman2018/examseal",
  contractUrl: `${explorerAddress(registry.address)}#code`,
  team: ["Sampurna", "Nooman", "Adithi", "Dhruva"],
} as const;

/** Colours shared by the icon and Open Graph image (same values as globals.css). */
export const BRAND = { slate: "#0f1419", ink: "#e6ebee", soft: "#95a3ad", line: "#2a3540" } as const;
