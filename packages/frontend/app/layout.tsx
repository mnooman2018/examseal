import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: "ExamSeal", template: "%s | ExamSeal" },
  description: SITE.summary,
  applicationName: SITE.name,
  openGraph: { type: "website", siteName: SITE.name, title: SITE.name, description: SITE.summary, url: "/" },
  twitter: { card: "summary_large_image", title: SITE.name, description: SITE.summary },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f1419" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
