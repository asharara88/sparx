#!/usr/bin/env python3
"""Judge a side-by-side walk (runs/<label>/<who>/<page>.{before,after}.txt).

Toddler homes: each false alarm is counted on main ("before") and on the new build ("after").
An alarm found before and gone after passes; still there after fails; never seen before is listed
as "not seen on main" (the walk cannot prove it gone).
Lana's home: every page that differs, with a short word diff, for the exceptions to be checked by eye.
Errors: any page that answered 5xx or failed to load, on either side.
"""
import difflib, glob, json, os, re, sys

RUN = os.path.join(os.environ.get("WALK_OUT", "/tmp/elnunu-walk"), "runs", sys.argv[1] if len(sys.argv) > 1 else "run")
TODDLERS = {"noor12": "girl", "adam18": "boy", "maya24": "girl", "yusuf36": "boy"}
LANA = ["mido", "dana", "wafa", "lilly"]

ALARMS = [
    ("Feed due now", r"Feed due now"),
    ("Due now", r"\bDue now\b"),
    ("Missed one?", r"Missed one\?"),
    ("No feed logged yet", r"No feed logged yet"),
    ("feeds in 24 h", r"feeds? in 24 h"),
    ("Last feed ... ago", r"Last feed [^\n]{0,20}\bago\b"),
    ("wet diaper(s)", r"wet diapers?\b"),
    ("No diaper for", r"No diaper for"),
    ("Babies this age", r"Babies this age"),
    ("try a nap now", r"try a nap now"),
    ("Vaccine overdue", r"Vaccine overdue"),
    ("window has closed", r"window has closed"),
    ("Fridge is low", r"Fridge is low"),
    ("0 bottles", r"(?<!\d)0 bottles"),
    ("usually 3 to 4", r"usually 3 to 4"),
    ("usually 3 a day", r"usually 3 a day"),
    ("Usual at this age", r"Usual at this age"),
    ("Probably hungry", r"Probably hungry"),
    ("entries to check", r"\d+ entr(y|ies) to check"),
    ("Over 10 hours", r"Over 10 hours"),
    ("Feed ~", r"Feed ~"),
    ("Diaper ~", r"Diaper ~"),
    ("0 feeds", r"(?<!\d)0 feeds"),
    ("0 diapers", r"(?<!\d)0 diapers"),
    ("N min awake", r"\d{3} min awake"),
    ("A quieter stretch", r"A quieter stretch"),
    ("Pumping 0 /", r"Pumping\s*·?\s*0 /"),
    ("Book it", r"Book it"),
]
BOY_ONLY = [("she / her for a boy", r"(?<![A-Za-z])(She|she|Her|her|herself)(?![A-Za-z])"), ("for girls", r"for girls|for a girl")]
OLD_ONLY = [("N months old (2 years and over)", r"\b(2[4-9]|[3-9]\d) months( old)?\b"), ("week N (2 years and over)", r"\bweek (10[4-9]|1[1-9]\d)\b")]
NO_NAP = [("Next nap (child with no nap)", r"Next nap"), ("longest naps (no nap)", r"longest naps")]
EXTRA = [tuple(x.split("=", 1)) for x in os.environ.get("JUDGE_EXTRA", "").split(";") if "=" in x]
# The walkers the saved-day seed adds (toddler_days.sql); with no folder they are simply not there.
SAVED_DAY_PEOPLE = ["noorcarer", "noorsimple"]
# A run with saved days (DAYS=1: the folder of a saved-day walker is there, so judging a run again
# by hand gives the same answer). What a home's own answers turn on is not a false alarm: Noor's
# day keeps the feed clock and says milk is stored.
SAVED = os.path.isdir(os.path.join(RUN, SAVED_DAY_PEOPLE[0]))
OWN = {"noor12": {"Feed due now", "Due now", "Missed one?", "Feed ~", "0 feeds", "Fridge is low", "0 bottles", "Pumping 0 /"}} if SAVED else {}


def pages(who):
    """Every capture of one person, by name: (old side, new side). A side with no file reads as
    empty, so a capture that failed on one build alone (walk.cjs then writes only that side) is seen."""
    out = {}
    names = {os.path.basename(f).rsplit(".", 2)[0] for f in glob.glob(os.path.join(RUN, who, "*.txt"))}
    for name in sorted(names):
        b, a = (os.path.join(RUN, who, f"{name}.{side}.txt") for side in ("before", "after"))
        out[name] = (open(b).read() if os.path.exists(b) else "", open(a).read() if os.path.exists(a) else "")
    return out


REL = [
    (re.compile(r"\b(\d+ h )?\d+ min ago\b"), "<ago>"), (re.compile(r"\b\d+ h ago\b"), "<ago>"),
    (re.compile(r"منذ (\d+ س )?\d+ د"), "<ago>"), (re.compile(r"منذ \d+ س"), "<ago>"),
    (re.compile(r"\b\d+ (мин|ч)( \d+ мин)? назад"), "<ago>"),
]


def norm(t):
    for rx, sub in REL:
        t = rx.sub(sub, t)
    return t


def find(rx, text):
    return re.findall(rx, text)


def errors(ps):
    bad = []
    for n, (b, a) in ps.items():
        for side, t in (("before", b), ("after", a)):
            first = t.split("\n", 1)[0]
            if re.match(r"# \S+ (ERROR|\(5\d\d\))", first) or "Something went wrong" in t:
                bad.append(f"{n} ({side})")
    return bad


report = {"toddlers": {}, "lana": {}, "errors": {}}
fails = 0
for who, sex in TODDLERS.items():
    ps = pages(who)
    rules = ALARMS + EXTRA + (BOY_ONLY if sex == "boy" else []) + (OLD_ONLY if who in ("maya24", "yusuf36") else []) + (NO_NAP if who == "yusuf36" else [])
    rows = []
    for lab, rx in rules:
        before = [n for n, (b, _) in ps.items() if find(rx, b)]
        after = [n for n, (_, a) in ps.items() if find(rx, a)]
        state = ("own" if lab in OWN.get(who, ()) else "FAIL") if after else ("gone" if before else "not seen on main")
        if state == "FAIL":
            fails += 1
        rows.append((state, lab, before, after))
    report["toddlers"][who] = {"rows": rows, "pages": len(ps)}

for who in LANA + list(TODDLERS) + SAVED_DAY_PEOPLE + ["nohome"]:
    ps = pages(who)
    report["errors"][who] = errors(ps)
    if who not in LANA and os.environ.get("JUDGE_DIFF_ALL") is None:
        continue
    diffs, timing = {}, []
    for n, (b, a) in ps.items():
        if b == a:
            continue
        if norm(b) == norm(a):
            timing.append(n)
            continue
        bl, al = norm(b).split("\n"), norm(a).split("\n")
        d = [l for l in difflib.unified_diff(bl, al, lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]
        diffs[n] = d
    report["lana"][who] = {"pages": len(ps), "differ": diffs, "timing_only": timing}

for who, r in report["toddlers"].items():
    print(f"\n== {who} ({r['pages']} pages)")
    for state, lab, before, after in r["rows"]:
        if state == "FAIL":
            print(f"  FAIL  {lab}: still on {', '.join(after)}")
        elif state == "own":
            print(f"  day   {lab}: on {', '.join(after)} (the family's own answer)")
        elif state == "gone":
            print(f"  gone  {lab} (was on {len(before)} page{'s' if len(before) != 1 else ''})")
    quiet = [lab for state, lab, _, _ in r["rows"] if state == "not seen on main"]
    if quiet:
        print(f"  not seen on main either: {', '.join(quiet)}")
for who, r in report["lana"].items():
    print(f"\n== {who}: {len(r['differ'])} of {r['pages']} pages differ" + (f" ({len(r['timing_only'])} more by a minutes-ago count only)" if r["timing_only"] else ""))
    for n, d in r["differ"].items():
        print(f"  -- {n}")
        for l in d[:14]:
            print(f"     {l[:170]}")
        if len(d) > 14:
            print(f"     ... {len(d) - 14} more lines")
errs = {w: e for w, e in report["errors"].items() if e}
print("\nerrors:", json.dumps(errs) if errs else "none")
print(f"{fails} alarm(s) still on a toddler page")
json.dump(report, open(os.path.join(RUN, "judge.json"), "w"), indent=1)
