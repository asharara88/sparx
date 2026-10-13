import { redirect } from "next/navigation";

export default function HandoverRedirect() {
  redirect("/lana?tab=handover");
}
