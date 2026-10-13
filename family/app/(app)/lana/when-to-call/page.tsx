import { PageHeader } from "@/components/PageHeader";
import { TOPICS } from "@/lib/lana-guide";

export default function WhenToCallPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/lana" title="When to call the doctor" subtitle="Warning signs from NHS, AAP and NICE guidance." />
      <div className="rounded-3xl bg-[var(--danger)] p-4 text-white">
        <p className="font-bold">Emergency? Call 998 (ambulance, UAE) now.</p>
        <p className="text-sm opacity-90">Do not wait for the app. If you are unsure, call her paediatrician.</p>
      </div>
      {TOPICS.map((t) => (
        <section key={t.id} id={t.id} className="card flex scroll-mt-4 flex-col gap-3">
          <h2 className="text-xl font-semibold">{t.title}</h2>
          <p className="notice notice-ok text-sm">
            <b>Usual: </b>
            {t.normal}
          </p>
          <div>
            <p className="font-bold">Call the doctor today if</p>
            <ul className="ml-5 list-disc text-sm">
              {t.call.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="notice notice-danger">
            <p className="font-bold">Call 998 or go to A&amp;E if</p>
            <ul className="ml-5 list-disc text-sm">
              {t.emergency.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <p className="muted text-xs">Sources: {t.src.join(" · ")}</p>
        </section>
      ))}
      <p className="muted text-xs">A summary of public health guidance, not a diagnosis. Her doctor knows Lana best.</p>
    </div>
  );
}
