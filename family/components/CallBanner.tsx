/** The red line at the top of When to call: the ambulance number, before anything else. */
export function CallBanner({ number, their }: { number: string | null; their: string }) {
  const ambulance = number ?? "your local emergency number";
  return (
    <div className="rounded-3xl bg-[var(--danger)] p-4 text-white">
      <p className="font-bold">
        Emergency? Call {ambulance}
        {number ? " (ambulance)" : ""} now.
      </p>
      <p className="text-sm opacity-90">Do not wait for the app. If you are unsure, call {their} paediatrician.</p>
    </div>
  );
}
