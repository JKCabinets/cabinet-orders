import { Metadata } from "next";
import { SLAClient } from "./SLAClient";

export const metadata: Metadata = { title: "SLA · JK Cabinets" };

export default function Page() {
  return <SLAClient />;
}
