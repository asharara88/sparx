"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, supabaseBrowser } from "@/lib/supabase/client";
import { ageDays, ageWords } from "@/lib/norms";
import { todayYmd } from "@/lib/time";
import { isToddler } from "@/lib/stage";
import { SignOutButton } from "./SignOutButton";

/**
 * A signed-in account that is in no home yet. Most people here were meant to join a
 * family already on elnunu (a mother signing in with her Gmail while her row carried
 * another address), so joining comes first: ask for an invite link, or for this e-mail
 * to be put on the Members screen, then "Check again". Starting a new home is the
 * deliberate second step, behind one more tap, so two taps never make two homes.
 * One form, six fields, the child first: household_create does the rest and me()
 * answers for the new home from the next render. With `another`, the same fields for a
 * member making a second home from More (Your homes): the page gives the title and the way
 * back, the form seeds their name from this home, and "Create the home" is the bottom
 * button. The account runs as the new home from then on, and Your homes goes back.
 * The date of birth is asked for in the form (naps, vaccines and what is usual go by age),
 * but not required by household_create: a home with no birth date works as before.
 * A home made for a child of 12 months or more opens on "{Name}'s day" once, filled in by
 * age: what a toddler's family logs is theirs to say. Leaving it loses nothing.
 */
export function CreateHome({ email, name, another = false }: { email: string | null; name?: string; another?: boolean }) {
  const router = useRouter();
  const [starting, setStarting] = useState(another);
  const [checking, setChecking] = useState(false);
  const guess = email ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  const [yourName, setYourName] = useState(name?.trim() || guess);
  const [homeName, setHomeName] = useState("");
  const [baby, setBaby] = useState("");
  const [born, setBorn] = useState("");
  const [sex, setSex] = useState<"Girl" | "Boy" | null>(null);
  const [tz, setTz] = useState("Asia/Dubai");
  const [zones, setZones] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (mine) setTz(mine);
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
      setZones(all.length ? all : [mine || "Asia/Dubai"]);
    } catch {
      setZones(["Asia/Dubai"]);
    }
  }, []);

  // The latest birth date is today in the home's time zone; a zone still being typed falls back to this phone's.
  const latest = (() => {
    try {
      return todayYmd(tz);
    } catch {
      return todayYmd(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    }
  })();
  const bornOk = /^\d{4}-\d{2}-\d{2}$/.test(born) && born <= latest;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!born) return setMsg("Add your child's date of birth.");
    if (!bornOk) return setMsg("The date of birth cannot be after today.");
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("household_create", {
      p_name: homeName.trim() || `${baby.trim()}'s home`,
      p_timezone: tz,
      p_child_name: baby.trim(),
      p_child_birth_date: born || null,
      p_child_sex: sex,
      p_display_name: yourName.trim() || null,
    });
    const res = data as { ok: boolean; message?: string; household_id?: string } | null;
    if (error || !res?.ok) {
      setBusy(false);
      return setMsg(res?.message ?? error?.message ?? "Could not create the home.");
    }
    // From 12 months the new home opens on the child's day, once. The age is counted to the
    // day the form held the birth date against.
    const first = isToddler(ageDays(born, latest)) ? "/baby/day?first=1" : null;
    // A second home: this device switches to it (the cookie every request carries), then the whole app
    // reloads for it. The form stays busy until the reload, so a slow switch cannot be submitted twice.
    // If the switch does not go through, this device would reload showing the old home, so say so instead.
    if (another) {
      if (res.household_id) {
        const switched = await apiFetch("/api/home/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ household_id: res.household_id }) })
          .then((r) => r.ok)
          .catch(() => false);
        if (!switched) {
          setBusy(false);
          return setMsg(`${homeName.trim() || "The home"} is made, but this phone could not switch to it. Pick it from Your homes, under More.`);
        }
      }
      // Only once this device runs as the new home: the day belongs to its child.
      return window.location.assign(res.household_id && first ? first : "/");
    }
    // A full load, as for a second home: the app starts for the new home on that screen.
    if (first) return window.location.assign(first);
    setBusy(false);
    router.refresh();
  }

  if (!starting) {
    return (
      <main className="mx-auto max-w-md p-6 pt-12">
        <div className="card flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold">Not in a home yet</h1>
            <p className="muted mt-1">You are signed in as {email ?? "you"}, but no home has you on its list yet.</p>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Joining a family already on elnunu?</h2>
            <p>
              Ask them for your invite link: on their Members screen, your name, then <b>Send an invite link</b>. Open it on this phone and you are in.
            </p>
            <p className="muted">Or ask them to put {email ? <b>{email}</b> : "this e-mail"} on your name there, then tap below.</p>
            <button
              type="button"
              className="btn btn-primary min-h-[56px] text-lg"
              disabled={checking}
              onClick={() => {
                setChecking(true);
                router.refresh();
                setTimeout(() => setChecking(false), 1500);
              }}
            >
              {checking ? "Looking…" : "Check again"}
            </button>
          </div>
          <div className="flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
            <h2 className="text-lg font-semibold">The first in your family here?</h2>
            <p className="muted">Start a home: you become its admin and add the rest of the family on its Members screen.</p>
            <button type="button" className="btn" onClick={() => setStarting(true)}>
              Start a new home
            </button>
          </div>
          <SignOutButton />
        </div>
      </main>
    );
  }

  const fields = (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Your child&apos;s name</span>
        <input className="input" value={baby} onChange={(e) => setBaby(e.target.value)} required autoComplete="off" autoFocus />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Born</span>
        <input className="input" type="date" value={born} onChange={(e) => { setBorn(e.target.value); setMsg(null); }} max={latest} aria-describedby="born-hint" />
        {bornOk && <span className="text-sm">= {ageWords(born, latest)} old</span>}
        <span id="born-hint" className="muted text-sm">
          Needed: naps, vaccines and what is usual go by age.
        </span>
      </label>
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Girl or boy</span>
        <div className="flex gap-2" role="group" aria-label="Girl or boy">
          {(["Girl", "Boy"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={sex === s} className="chip" onClick={() => setSex(sex === s ? null : s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Your name</span>
        <input className="input" value={yourName} onChange={(e) => setYourName(e.target.value)} required autoComplete="given-name" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Name the home</span>
        <input className="input" value={homeName} onChange={(e) => setHomeName(e.target.value)} placeholder={baby ? `${baby}'s home` : "Family home"} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Timezone</span>
        {zones.length > 1 ? (
          <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
            {zones.includes(tz) ? null : <option value={tz}>{tz}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        ) : (
          <input className="input" value={tz} onChange={(e) => setTz(e.target.value)} />
        )}
        <span className="muted text-sm">Every time in the app is shown in it.</span>
      </label>
    </>
  );
  const error = msg && (
    <p className="notice notice-danger" role="alert">
      {msg}
    </p>
  );
  const cannotSubmit = busy || !baby.trim() || !yourName.trim();
  const submitLabel = busy ? "Creating…" : "Create the home";

  // A second home, from More: a settings screen under its own header (the page draws it, with
  // the back arrow), the fields in one card and "Create the home" as the bottom button, so the
  // helper's button moves up clear of it.
  if (another) {
    return (
      <>
        <form id="create-home" onSubmit={submit} className="card flex flex-col gap-4">
          {fields}
        </form>
        <div className="bottom-action flex flex-col gap-2">
          {error}
          <button type="submit" form="create-home" className="btn btn-primary btn-lg w-full" disabled={cannotSubmit}>
            {submitLabel}
          </button>
        </div>
      </>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6 pt-12">
      <form onSubmit={submit} className="card flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">Start your home</h1>
          <p className="muted mt-1">
            You are its admin: you add the rest of the family on the Members screen and send them their invite links. If someone already added your e-mail to their home, you land there instead.
          </p>
        </div>
        {fields}
        {error}
        <button type="submit" className="btn btn-primary min-h-[56px] text-lg" disabled={cannotSubmit}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={() => setStarting(false)} disabled={busy}>
          Back: I am joining a family instead
        </button>
      </form>
    </main>
  );
}
