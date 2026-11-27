"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CHEER_REST } from "@/lib/cheers";
import { nightLine, stretchWords, timesWords } from "@/lib/nights";
import { CheerSheet } from "./CheerSheet";
import { Icon } from "./Icon";
import { SavedTick } from "./SavedTick";
import { Sheet } from "./Sheet";

/**
 * The morning after a broken night (DESIGN.md, "Cheers and shared nights"): one line on the
 * other parent's Home, for a member who chose to share her nights, from when the night ends
 * until noon. The line carries one fact; the sheet behind it carries the second and the two
 * things that can be done about it: take the child now (the header's own "with ..." switch,
 * in one tap) and send a cheer. Taking the child keeps the sheet open, so a cheer can follow
 * it ("Rest, I have the morning" is offered only once it is true).
 *
 * After the question she answered (NightAsk), she is never shown any of this about herself,
 * and nothing here measures her: it says how the night went, and what he can do.
 */
export function NightNotice({ sharer, times, longestMin, nightDay, subjectId, child, meId, canTake, holding }: { sharer: { id: string; name: string }; times: number; longestMin: number; /** The home date the night started on. */ nightDay: string; subjectId: string; child: string; meId: string; /** May the viewer say who has the child. */ canTake: boolean; /** The viewer has the child already. */ holding: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cheer, setCheer] = useState(false);
  const [took, setTook] = useState(false);
  // Derived, not kept: Home may learn after a refresh that someone else has the child now.
  const have = holding || took;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  async function take() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("custody_set", { p_subject_id: subjectId, p_member_id: meId });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not change that. Try again.");
    setTook(true);
    setChanged(true);
  }
  function close() {
    setOpen(false);
    // Home catches up once the sheet is closed: the header's "with ...", and this line, which has done its work.
    if (changed) router.refresh();
    setTook(false);
  }

  return (
    <>
      <button type="button" className="notice tint-sleep w-full text-left" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="moon" size={20} /> <span className="flex-1 font-semibold">{nightLine(sharer.name, times)}</span> <Icon name="forward" size={18} />
      </button>
      {open && (
        <Sheet title={`${sharer.name}'s night`} onClose={close}>
          <div className="flex flex-col gap-3 pb-2">
            <div>
              <p className="text-lg font-semibold">{timesWords(times)}</p>
              <p>Longest quiet stretch: {stretchWords(longestMin)}.</p>
            </div>
            <p className="muted text-sm">{sharer.name} chose to share this. It is a guess from what was saved.</p>
            {have ? (
              <p role="status" className="notice notice-ok flex items-center gap-3">
                {took && <SavedTick />} <span className="flex-1 font-semibold">{took ? `You have ${child} now.` : `You have ${child}.`}</span>
              </p>
            ) : (
              canTake && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void take()}>
                  I have {child} now
                </button>
              )
            )}
            <button type="button" className={have || !canTake ? "btn btn-primary" : "btn"} onClick={() => setCheer(true)}>
              Send a cheer
            </button>
            {msg && (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {msg}
              </p>
            )}
          </div>
        </Sheet>
      )}
      {cheer && (
        <CheerSheet
          target={{ to: sharer, about: "night", refDay: nightDay, forWords: "last night" }}
          extra={have ? CHEER_REST : null}
          onClose={() => {
            setCheer(false);
            setChanged(true);
          }}
        />
      )}
    </>
  );
}
