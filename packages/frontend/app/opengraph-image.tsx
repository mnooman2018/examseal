import { ImageResponse } from "next/og";
import { BRAND, SITE } from "@/lib/site";

// Link-preview card: the name and the one-line summary on dark slate. Text and one icon only.
export const alt = `${SITE.name}: ${SITE.summary}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Edge runtime: the Node build of next/og fails to resolve its bundled font path on Windows.
export const runtime = "edge";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          background: BRAND.slate,
          color: BRAND.ink,
          borderLeft: `16px solid ${BRAND.line}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="128" height="128" viewBox="6 4 20 24">
            <path d="M11 14v-3a5 5 0 0 1 10 0v3" fill="none" stroke={BRAND.ink} strokeWidth="2.4" />
            <path fill={BRAND.ink} fillRule="evenodd" d="M8 14h16v12H8z M16 17.5a1.8 1.8 0 0 0-1 3.3V23h2v-2.2a1.8 1.8 0 0 0-1-3.3z" />
          </svg>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: 18 }}>EXAMSEAL</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 44, lineHeight: 1.3, maxWidth: 980 }}>{SITE.summary}</div>
        <div style={{ marginTop: 56, fontSize: 28, color: BRAND.soft }}>Built on MST Blockchain. Demo on MST Testnet.</div>
      </div>
    ),
    size
  );
}
