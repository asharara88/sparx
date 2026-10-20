# Pipeline schema (AI YouTube Studio)

`0001_init_episode_state.sql` is the episode-state table the pipeline in `src/` reads
through `src/state/supabase.ts`. It is kept here as the reference schema. It used to sit in
the repo-root `supabase/migrations` folder, which the Supabase GitHub integration for the
family app's project (`home`) reads by default; that made the integration try to match the
family database against this unrelated file and fail on every push to `main`.

The repo-root `supabase` entry is now a link to `family/supabase`, so the integration and
the Supabase CLI find the family migrations from the root as well as from `family/`.
