import { redirect } from "next/navigation";

/** Alerts now live on Home ("Today"). Old links land there. */
export default function AlertsPage() {
  redirect("/");
}
