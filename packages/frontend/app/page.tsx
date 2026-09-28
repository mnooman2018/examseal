import type { Metadata } from "next";
import { ControlRoomPage } from "@/components/ControlRoom";

export const metadata: Metadata = {
  // The root layout's title template does not apply to a page in the same segment, so set it in full.
  title: { absolute: "Control room | ExamSeal" },
  description:
    "Live status of every exam centre, read from MST Testnet: phase, release countdown in chain time, and approvals per centre.",
};

export default function Page() {
  return <ControlRoomPage />;
}
