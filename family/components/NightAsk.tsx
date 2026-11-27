"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { nightLine, stretchWords } from "@/lib/nights";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/**
 * The question, on her own Home until she answers it (DESIGN.md, "Cheers and shared nights"):
 * may the other parent be told how her nights go. Nothing about her night is shown to anyone
 * until she says yes here, and before she answers she reads the very words they would read,
 * made from a real night of hers. Either answer ends the asking; closing the sheet does not.
 * The switch stays hers afterwards, in More, Display.
 *
 * A yes is to the parents this screen names: their ids go with it, and the database keeps
 * only those. If another parent joined while the screen was open, the yes does not count yet
 * and she is asked again with both names; the same happens later whenever a parent joins.
 */
export function NightAsk({ names, ids, me, sample }: { /** The other parent, or parents, by name: "Omar", "Omar and Sam". */ names: string; /** The same parents, by member id: what her yes is a yes to. */ ids: string[]; me: string; /** A real night of hers that would give a line. */ sample: { name: string; times: number; longestMin: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function answer(on: boolean) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("me_night_share_set", { p_on: on, p_seen: ids });
    setBusy(false);
    const res = data as { ok: boolean; night_share?: boolean | null; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save that. Try again.");
    // A yes that did not take: someone became a parent here after this screen was drawn. Nobody
    // has been told anything; the names are read again and she answers with all of them in view.
    if (on && res.night_share !== true) {
      setMsg("Someone else is a parent here now. Look at the names again, then answer.");
      return router.refresh();
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="notice tint-sleep w-full text-left" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="moon" size={20} /> <span className="flex-1 font-semibold">Tell {names} how your nights go?</span> <Icon name="forward" size={18} />
      </button>
      {open && (
        <Sheet title="Your nights" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3 pb-2">
            <p>When you save things in the night, {names} can see one line the next morning, so they can take over or send a cheer.</p>
            <div>
              <p className="muted text-sm">After {sample.name} it would say:</p>
              <div className="notice tint-sleep mt-1">
                <p className="font-semibold">{nightLine(me, sample.times)}</p>
                <p>Longest quiet stretch: {stretchWords(sample.longestMin)}.</p>
              </div>
            </div>
            <p className="muted text-sm">
              It is a guess from what you saved. Only {names} can see it, until noon, after a night with two wakings or more. The log still shows who saved each entry, as it always has. You can turn this off in More, Display.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn" disabled={busy} onClick={() => void answer(false)}>
                No thanks
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void answer(true)}>
                Yes, tell {names}
              </button>
            </div>
            {msg && (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {msg}
              </p>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
