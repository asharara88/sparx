import { redirect } from "next/navigation";

export default function HandoverRedirect() {
  redirect("/baby?tab=handover");
}
