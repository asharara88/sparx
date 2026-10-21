// The plan behind scripts/setup-household.mjs: what a household.json means for the
// members already in the home, worked out and checked in full BEFORE anything is
// written. Pure functions, so the unit tests exercise the matching, the account
// rules and the validation without a database.
//
// Matching, in order: `id` (a member row's uuid, printed by every run), else the
// e-mail, else the name. A row that is linked to a sign-in account keeps that link:
// changing its e-mail is refused unless the member says `relink: true`, which drops
// the old link so --accounts can make the new one. A deactivated member comes back
// only with `active: true`; `active: false` deactivates. Members in the home but not
// in the file are reported and left alone, unless `household.deactivate_missing`
// is true.

export const ROLES = ["admin", "family_carer", "home_carer", "sitter"];
export const LANGS = ["en", "ar", "ru"];
export const PRESENCES = ["lives_here", "staying_with_us", "visiting_today", "away"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (s) => (s == null ? null : String(s).trim().toLowerCase() || null);

/** Problems with the file itself, before the database is even looked at. */
export function validateConfig(cfg) {
  const errors = [];
  const hh = cfg?.household ?? {};
  if (!hh.name) errors.push("household.name is required.");
  if (hh.id && !UUID.test(hh.id)) errors.push("household.id is not a uuid.");
  if (!cfg?.child?.name) errors.push("child.name is required: the app is the child's day.");
  const members = Array.isArray(cfg?.members) ? cfg.members : [];
  if (!members.length) errors.push("members is empty: at least one admin is needed.");
  const names = new Set();
  const emails = new Set();
  for (const m of members) {
    const who = m.name ? `member ${m.name}` : "a member";
    if (!m.name) errors.push("every member needs a name");
    if (!ROLES.includes(m.role)) errors.push(`${who}: role must be one of ${ROLES.join(", ")}`);
    if (m.lang != null && !LANGS.includes(m.lang)) errors.push(`${who}: lang must be ${LANGS.join(", ")}`);
    if (m.presence != null && !PRESENCES.includes(m.presence)) errors.push(`${who}: presence must be one of ${PRESENCES.join(", ")}`);
    if (m.id && !UUID.test(m.id)) errors.push(`${who}: id is not a uuid`);
    if (m.active != null && typeof m.active !== "boolean") errors.push(`${who}: active must be true or false`);
    if (Array.isArray(m.work_days) && m.work_days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.push(`${who}: work_days are 0 (Sunday) to 6`);
    const n = norm(m.name);
    if (n && names.has(n)) errors.push(`${who}: the name appears twice in the file`);
    if (n) names.add(n);
    const e = norm(m.email);
    if (e && emails.has(e)) errors.push(`${who}: the e-mail ${e} appears twice in the file`);
    if (e) emails.add(e);
  }
  if (!members.some((m) => m.role === "admin" && m.active !== false)) errors.push("at least one member must be an admin (and not deactivated)");
  return errors;
}

/**
 * The members plan. `existing` is every member row of the home (active or not):
 * { id, display_name, email, user_id, is_active }. Returns the row to write per
 * configured member, what to do with the rows the file leaves out, and the
 * errors that must stop the run before any write.
 */
export function planMembers(cfg, existing, homeId) {
  const errors = [];
  const warnings = [];
  const byId = new Map(existing.map((m) => [m.id, m]));
  const byEmail = new Map(existing.filter((m) => m.email).map((m) => [norm(m.email), m]));
  const byName = new Map(existing.map((m) => [norm(m.display_name), m]));
  const taken = new Set();
  const members = [];
  for (const m of cfg.members ?? []) {
    const email = norm(m.email);
    let found = null;
    if (m.id) {
      found = byId.get(m.id) ?? null;
      if (!found) errors.push(`member ${m.name}: no member in this home has id ${m.id}`);
    } else found = (email && byEmail.get(email)) || byName.get(norm(m.name)) || null;
    if (found && taken.has(found.id)) errors.push(`member ${m.name}: matches the same row as another member in the file (${found.display_name})`);
    if (found) taken.add(found.id);

    const row = {
      household_id: homeId,
      display_name: m.name,
      email,
      role_id: m.role,
      relationship: m.relationship ?? null,
      birth_date: m.birth_date ?? null,
      breastfeeds: !!m.breastfeeds,
      work_from: m.work_from ?? null,
      work_to: m.work_to ?? null,
      routine: m.routine ?? null,
      lang: m.lang ?? "en",
    };
    let relink = false;
    let note = "";
    if (!found) {
      row.is_active = m.active !== false;
      if (!row.is_active) warnings.push(`member ${m.name}: active: false on a member who is not in the home yet; added deactivated`);
      members.push({ action: "insert", found: null, row, relink, note });
      continue;
    }
    // The sign-in link: a row linked to an account keeps it unless the file says relink.
    if (found.user_id && email && norm(found.email) !== email) {
      if (m.relink === true) {
        relink = true;
        row.user_id = null;
        note = `unlinked from the account for ${found.email ?? "(no e-mail)"}; --accounts links ${email}`;
      } else {
        errors.push(`member ${m.name}: is linked to the sign-in account for ${found.email ?? "(no e-mail)"}; keep that e-mail, or set "relink": true to move them to ${email}`);
      }
    }
    // Deactivated members come back only on purpose.
    if (found.is_active === false) {
      if (m.active === true) {
        row.is_active = true;
        note = note ? `${note}; reactivated` : "reactivated";
      } else if (m.active === false) {
        row.is_active = false;
      } else {
        errors.push(`member ${m.name}: is deactivated; set "active": true to bring them back, or take them out of the file`);
      }
    } else if (m.active === false) {
      row.is_active = false;
      note = note ? `${note}; deactivated` : "deactivated";
    } else row.is_active = true;
    members.push({ action: "update", found, row, relink, note });
  }

  // Rows the file does not mention.
  const missing = existing
    .filter((e) => !taken.has(e.id) && e.is_active !== false)
    .map((e) => ({ id: e.id, display_name: e.display_name, action: cfg.household?.deactivate_missing === true ? "deactivate" : "keep" }));
  for (const x of missing) {
    if (x.action === "keep") warnings.push(`${x.display_name} is in the home but not in the file: left as is (household.deactivate_missing: true would deactivate them)`);
  }
  return { errors, warnings, members, missing };
}

/** What --accounts should say about a member after the account exists: the link is never silently assumed. */
export function linkOutcome(member, userId) {
  if (!userId) return { link: false, text: "no account id came back; not linked" };
  if (!member.user_id) return { link: true, text: "linked" };
  if (member.user_id === userId) return { link: false, text: "already linked to this account" };
  return { link: false, text: 'linked to a different account; kept (set "relink": true to move them)' };
}
