"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SignOutButton } from "./SignOutButton";

/**
 * A signed-in account that is in no home yet: make one, or wait to be added.
 * One screen, six fields, the baby first. household_create does the rest and
 * me() answers for the new home from the next render. With `another`, the same
 * form for a member making a second home from the Me screen: the account runs
 * as the new home from then on, and the switcher goes back.
 */
export function CreateHome({ email, another = false }: { email: string | null; another?: boolean }) {
  const router = useRouter();
  const Wrap = another ? "div" : "main";
  const guess = email ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  const [yourName, setYourName] = useState(guess);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
    setBusy(false);
    const res = data as { ok: boolean; message?: string; household_id?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not create the home.");
    // A second home: this device switches to it (the cookie every request carries), then the whole app reloads for it.
    if (another) {
      if (res.household_id) {
        await fetch("/api/home/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ household_id: res.household_id }) }).catch(() => null);
      }
      return window.location.assign("/");
    }
    router.refresh();
  }

  return (
    <Wrap className={another ? "flex flex-col gap-4" : "mx-auto max-w-md p-6 pt-12"}>
      <form onSubmit={submit} className="card flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">{another ? "Create another home" : "Create your home"}</h1>
          <p className="muted mt-1">
            {another
              ? "You stay in your current home too, and switch between them from your settings. The new home starts empty: you are its admin and add its family on its Members screen."
              : "You are signed in but not in a home yet. Make one here, and you are its admin: you add the rest of the family on the Members screen. If someone already added your e-mail to their home, you will land there instead."}
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">The baby&apos;s name</span>
          <input className="input" value={baby} onChange={(e) => setBaby(e.target.value)} required autoComplete="off" autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Born</span>
            <input className="input" type="date" value={born} onChange={(e) => setBorn(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
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
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Your name</span>
          <input className="input" value={yourName} onChange={(e) => setYourName(e.target.value)} required autoComplete="given-name" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Name the home</span>
          <input className="input" value={homeName} onChange={(e) => setHomeName(e.target.value)} placeholder={baby ? `${baby}'s home` : "Our home"} />
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
        {msg && (
          <p className="notice notice-danger" role="alert">
            {msg}
          </p>
        )}
        <button type="submit" className="btn btn-primary min-h-[56px] text-lg" disabled={busy || !baby.trim() || !yourName.trim()}>
          {busy ? "Creating…" : "Create the home"}
        </button>
        {another ? (
          <Link href="/me" className="btn">
            Back
          </Link>
        ) : (
          <>
            <p className="muted text-sm">Signed in as {email ?? "you"}. Waiting to be added to someone else&apos;s home instead? Just sign out and come back once they have.</p>
            <SignOutButton />
          </>
        )}
      </form>
    </Wrap>
  );
}
