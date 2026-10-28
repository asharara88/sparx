import { PageHeader } from "@/components/PageHeader";

/** How to put the app on the phone's home screen. */
export default function InstallPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Add to your phone" />
      <div className="card flex flex-col gap-2">
        <p>
          <b>iPhone:</b> in Safari tap Share, then “Add to Home Screen”.
        </p>
        <p>
          <b>Android:</b> in Chrome tap the menu (⋮), then “Install app” or “Add to Home screen”.
        </p>
      </div>
    </div>
  );
}
