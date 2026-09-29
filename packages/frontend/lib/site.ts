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

/** "Sampurna, Nooman, Adithi and Dhruva". */
export const TEAM_NAMES = `${SITE.team.slice(0, -1).join(", ")} and ${SITE.team[SITE.team.length - 1]}`;

/** Colours for the apple icon and Open Graph image (same values as the ui-v2 tokens in globals.css). */
export const BRAND = { bg: "#0b0b0c", ink: "#f2f2f3", soft: "#a3a3ab", line: "#27272c" } as const;

/** Padlock drawn in a 32×32 box: shackle and body with a keyhole cut out. One colour. */
export const LOCK_PATHS = {
  shackle: "M11 14v-3a5 5 0 0 1 10 0v3",
  body: "M8 14h16v12H8z M16 17.5a1.8 1.8 0 0 0-1 3.3V23h2v-2.2a1.8 1.8 0 0 0-1-3.3z",
} as const;
