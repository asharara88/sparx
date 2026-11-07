import { redirect } from "next/navigation";

/** The dashboard is Home now (Mido, 7 November): sleep, feeds, food and pumping sit below the log rows. */
export default function DashboardPage() {
  redirect("/#today");
}
