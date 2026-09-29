import { ImageResponse } from "next/og";
import { BRAND, LOCK_PATHS } from "@/lib/site";

// Padlock, one colour on the dark background, drawn in code.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
// Edge runtime: the Node build of next/og fails to resolve its bundled font path on Windows.
export const runtime = "edge";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.bg }}>
        <svg width="132" height="132" viewBox="0 0 32 32">
          <path d={LOCK_PATHS.shackle} fill="none" stroke={BRAND.ink} strokeWidth="2.4" />
          <path d={LOCK_PATHS.body} fill={BRAND.ink} fillRule="evenodd" />
        </svg>
      </div>
    ),
    size
  );
}
