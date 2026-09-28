import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/site";

// Same padlock as app/icon.svg, one colour on dark slate, drawn in code.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
// Edge runtime: the Node build of next/og fails to resolve its bundled font path on Windows.
export const runtime = "edge";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.slate }}>
        <svg width="132" height="132" viewBox="0 0 32 32">
          <path d="M11 14v-3a5 5 0 0 1 10 0v3" fill="none" stroke={BRAND.ink} strokeWidth="2.4" />
          <path
            fill={BRAND.ink}
            fillRule="evenodd"
            d="M8 14h16v12H8z M16 17.5a1.8 1.8 0 0 0-1 3.3V23h2v-2.2a1.8 1.8 0 0 0-1-3.3z"
          />
        </svg>
      </div>
    ),
    size
  );
}
