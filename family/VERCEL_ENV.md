# Environment variables on Vercel (project `sparx-tsom`, root directory `family`)

Every variable the app reads, what stops working without it, and where the value
comes from. Set each one for **Production** and **Preview** unless noted. Mark the
ones flagged *Sensitive* as Sensitive in Vercel so they can never be read back.
Values for the generated ones are in the setup note sent in chat; secrets are never
committed here.

Check what is set: Vercel → Project → Settings → Environment Variables, or
`vercel env ls --environment production` with the CLI.

## 1. Must have (the app does not work without these)

| Variable | Sensitive | Where to get it | Without it |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | `https://qjqekazawirrpwnwgbhd.supabase.co` | Nothing loads; the site shows "not configured". |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Supabase → project `home` → Settings → API → publishable key (`sb_publishable_…`). `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is accepted as an alias. | Same as above. |

## 2. Needed for the assistant (Ask, morning brief, receipts, cart report, weekly plan)

Pick **one** of the two ways.

**A. An API key** (simplest)

| Variable | Sensitive | Where to get it | Without it |
|---|---|---|---|
| `ANTHROPIC_API_KEY` (or `ANTHROPIC_API_SECRET_KEY`, either name works) | yes | console.anthropic.com → API keys. Create it **inside a workspace**, not at organisation level. | Ask and the brief say "not set up"; everything else works. |
| `ELEVENLABS_API_KEY` | no | elevenlabs.io → Profile → API keys. Optional `ELEVENLABS_VOICE_ID` (default "Matilda") and `ELEVENLABS_MODEL` (default `eleven_multilingual_v2`; `eleven_flash_v2_5` costs half). | Listen and read-aloud use the phone's own voice (its warmest female one). |
| `ANTHROPIC_WORKSPACE_ID` | no | Only if the key is organisation-level and the API answers "not scoped to a workspace": console → Settings → Workspaces. | That 400 error on the brief card. |

**B. No key, Workload Identity Federation**

| Variable | Sensitive | Where to get it |
|---|---|---|
| `ANTHROPIC_FEDERATION_RULE_ID` | no | Claude Console → federation rule for this project (`fdrl_…`). Issuer `https://oidc.vercel.com/ahmedmsharara-4731s-projects`, subject `owner:ahmedmsharara-4731s-projects:project:sparx-tsom:environment:production`. |
| `ANTHROPIC_ORGANIZATION_ID` | no | Console → Settings → Organization (uuid). |
| `ANTHROPIC_SERVICE_ACCOUNT_ID` | no | Console → service account in the workspace (`svac_…`). |
| `ANTHROPIC_WORKSPACE_ID` | no | Only if the rule spans several workspaces. |

Also switch on *Secure backend access with OIDC federation* in the Vercel project
(Settings → Security). Vercel then provides `VERCEL_OIDC_TOKEN` on its own; the app
hands it to the SDK as `ANTHROPIC_IDENTITY_TOKEN`. Leave the key variables unset.

**Optional tuning**

| Variable | Default | Notes |
|---|---|---|
| `ASSISTANT_MODEL` | `claude-opus-5-5` | Any current Claude model id. |
| `ASSISTANT_EFFORT` | `medium` | `low`, `medium` or `high`. |

## 3. Needed for push notifications and the daily cron

| Variable | Sensitive | Where to get it | Without it |
|---|---|---|---|
| `VAPID_PUBLIC_KEY` | no | Generated once with `npx web-push generate-vapid-keys`. Already generated; see the setup note. | Me → Notifications cannot subscribe. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | no | Same value as `VAPID_PUBLIC_KEY` (the browser needs it). | Same. |
| `VAPID_PRIVATE_KEY` | **yes** | From the same generation. | Pushes fail to send. |
| `VAPID_SUBJECT` | no | `mailto:` + your e-mail, or `https://elnunu.com`. | Push services reject the sender. |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Supabase → Settings → API → `service_role` secret. | The cron cannot read subscriptions or write notifications. |
| `SUPABASE_JWT_SECRET` | **yes** | Supabase → Settings → API → JWT Settings → JWT Secret. | The cron cannot act as each member, so no brief, no reminders, no weekly plan. |
| `CRON_SECRET` | **yes** | Any long random string. Already generated; see the setup note. Vercel sends it as `Authorization: Bearer` on cron calls. | The cron route refuses every call. |

`vercel.json` schedules `/api/cron/daily` at 06:55 Dubai. The Hobby plan allows one
daily cron; on Pro add `{ "path": "/api/cron/often", "schedule": "*/15 * * * *" }`
for bottle reminders between the daily runs.

## 4. Optional

| Variable | Notes |
|---|---|
| `PLAN_EVERY_DAY=1` | Draft the weekly plan every day instead of Sundays, while trying it out. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google's own sign-in button on the login and invite screens: the OAuth client id (public by design; README, *Google sign-in*). Without it the button still works through Supabase's redirect, but Google's screen then says "Sign in to qjqekazawirrpwnwgbhd.supabase.co" instead of elnunu.com. |

## 5. Never set on Vercel

| Variable | Why |
|---|---|
| `FAMILY_LOCAL_DB` | Screenshot mode: points the app at a local Postgres through psql. Local only. |
| `MEMBER_EMAILS` | Only for `npm run seed:accounts` from your machine. |
| `TRACE` | Local debug logging. |
| `ANTHROPIC_IDENTITY_TOKEN`, `ANTHROPIC_IDENTITY_TOKEN_FILE`, `VERCEL_OIDC_TOKEN` | Set by the code or by Vercel at runtime, never by hand. |

## 6. How to confirm each one from the phone

- Supabase pair: the login page loads and sign-in works.
- Assistant: Home → the brief card shows a brief, not "not set up"; Chat → Ask answers.
- Push: Me → Notifications → the toggle turns on and a test notification arrives.
- Cron: Vercel → Project → Cron Jobs shows the 06:55 run succeeded; the brief card is fresh the next morning.
- Service role and JWT secret: the cron run logs no "not configured" line.

## 7. After changing variables

Vercel only reads variables at deploy time. After adding or changing any, open the
latest Production deployment and choose **Redeploy**.
