import { Barlow_Condensed, Inter, JetBrains_Mono } from "next/font/google";

// MST look (D11, D12). next/font downloads these at build time and serves them from this site,
// so pages make no runtime requests to Google. Fallbacks live in globals.css.
export const display = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
export const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
