/** Shown at the top while an admin is viewing the app as someone else. */
export function PreviewBanner({ name, role }: { name: string; role: string }) {
  return (
    <form action="/api/view-as" method="post" className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 bg-amber-200 px-4 py-2 text-amber-950">
      <span className="text-sm">
        Viewing as <strong>{name}</strong> ({role}). Read only.
      </span>
      <input type="hidden" name="exit" value="1" />
      <button type="submit" className="rounded-lg border-2 border-amber-900 px-3 py-1 text-sm font-semibold">
        Back to me
      </button>
    </form>
  );
}
