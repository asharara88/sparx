import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Screenshot mode: a stand-in for the Supabase client that talks to a plain
 * local Postgres (the one supabase/tests/run-local.sh builds) through psql,
 * as a given member, with RLS on. Only RPCs and the simple table reads the
 * pages use. Switched on by FAMILY_LOCAL_DB=<database>; never set in production.
 */
type Filter = { col: string; op: string; val: unknown };

function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return `array[${v.map(literal).join(",")}]::text[]`;
  return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
}

function run(db: string, uid: string, sql: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fam-"));
  chmodSync(dir, 0o755);
  const file = join(dir, "q.sql");
  writeFileSync(
    file,
    `\\set QUIET on\n\\o /dev/null\nselect set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);\nset role authenticated;\n\\o\n${sql}\n`,
  );
  chmodSync(file, 0o644);
  try {
    const out = execFileSync("su", ["postgres", "-c", `psql -X -A -t -q -v ON_ERROR_STOP=1 -d ${db} -f ${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const lines = out.split("\n").filter((l) => l.trim() !== "");
    return lines[lines.length - 1] ?? "null";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

class Query {
  private cols = "*";
  private filters: Filter[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private mode: "list" | "single" | "maybe" = "list";
  constructor(private db: string, private uid: string, private table: string) {}
  select(cols = "*") {
    this.cols = cols.trim() === "*" ? "*" : cols.split(",").map((c) => c.trim()).join(", ");
    return this;
  }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "=", val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ col, op: "<>", val }); return this; }
  gt(col: string, val: unknown) { this.filters.push({ col, op: ">", val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ col, op: ">=", val }); return this; }
  lt(col: string, val: unknown) { this.filters.push({ col, op: "<", val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ col, op: "<=", val }); return this; }
  in(col: string, vals: unknown[]) { this.filters.push({ col, op: "in", val: vals }); return this; }
  is(col: string, val: null | boolean) { this.filters.push({ col, op: "is", val }); return this; }
  not(col: string, op: string, val: unknown) { this.filters.push({ col, op: `not ${op}`, val }); return this; }
  order(col: string, opts: { ascending?: boolean } = {}) { this.orders.push(`${col} ${opts.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  private sql() {
    const where = this.filters.map((f) => {
      if (f.op === "in") return `${f.col} in (${(f.val as unknown[]).map(literal).join(",")})`;
      if (f.op === "is" || f.op === "not is") return `${f.col} ${f.op} ${f.val === null ? "null" : f.val}`;
      return `${f.col} ${f.op} ${literal(f.val)}`;
    });
    return `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (select ${this.cols} from public.${this.table}${where.length ? " where " + where.join(" and ") : ""}${this.orders.length ? " order by " + this.orders.join(", ") : ""}${this.lim != null ? " limit " + this.lim : ""}) t;`;
  }
  then<T>(resolve: (v: { data: unknown; error: null | { message: string } }) => T, reject?: (e: unknown) => T) {
    try {
      const rows = JSON.parse(run(this.db, this.uid, this.sql())) as unknown[];
      const data = this.mode === "list" ? rows : rows[0] ?? null;
      return Promise.resolve({ data, error: this.mode === "single" && !data ? { message: "no rows" } : null }).then(resolve, reject);
    } catch (e) {
      return Promise.resolve({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }).then(resolve, reject);
    }
  }
}

export function localClient(db: string, uid: string, email: string): SupabaseClient {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: uid, email } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: uid, email }, access_token: "local" } }, error: null }),
      signOut: async () => ({ error: null }),
    },
    rpc: async (name: string, params: Record<string, unknown> = {}) => {
      try {
        const args = Object.entries(params).map(([k, v]) => `${k} => ${literal(v)}`).join(", ");
        const out = run(db, uid, `select coalesce(to_jsonb(public.${name}(${args})), 'null'::jsonb)::text;`);
        return { data: JSON.parse(out), error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
    from: (table: string) => new Query(db, uid, table),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no storage in screenshot mode" } }) }) },
  };
  return client as unknown as SupabaseClient;
}
