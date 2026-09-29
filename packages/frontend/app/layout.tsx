import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import { AppShell } from "@/components/AppShell";
import { body, display, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "ExamSeal",
  description:
    "Exam papers that no single person can open early, and that trace any leak back to the centre it came from. Built on MST Blockchain.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
