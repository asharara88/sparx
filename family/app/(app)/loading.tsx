/**
 * Shown the moment a section is tapped, while its data comes: the tab bar stays, and
 * the screen answers at once instead of freezing on the last one.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4 pt-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-20" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-32" />
        <div className="skeleton h-32" />
        <div className="skeleton h-32" />
        <div className="skeleton h-32" />
      </div>
      <div className="skeleton h-14" />
      <div className="skeleton h-14" />
    </div>
  );
}
