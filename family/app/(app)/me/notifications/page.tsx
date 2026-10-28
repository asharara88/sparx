import { NotificationsToggle } from "@/components/NotificationsToggle";
import { PageHeader } from "@/components/PageHeader";

/** Notifications on this phone. */
export default function NotificationsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Notifications" />
      <NotificationsToggle />
    </div>
  );
}
