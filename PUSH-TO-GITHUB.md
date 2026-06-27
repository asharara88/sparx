# Push SPARX to the `sparx` GitHub repo

The full project is in `SPARX STUDIOS/ai-youtube-studio/` (82 files). A complete
snapshot is also in `SPARX STUDIOS/sparx.bundle`.

I can't push from this session — the GitHub connector only supports manual auth
and is currently disconnected, and I won't handle a token in chat. Pick one:

## Option 1 — Connect GitHub, then I push
Run `/mcp`, authenticate **GitHub**, tell me "GitHub connected", and I'll push.

## Option 2 — Push from your Mac (≈1 min)
```bash
cd ~/Claude/Projects/"SPARX STUDIOS"/ai-youtube-studio
rm -rf .git                      # clears stale sandbox lock files
git init -b main
git add -A
git commit -m "SPARX AI YouTube Studio"
git remote add origin https://github.com/<your-username>/sparx.git
git push -u origin main          # add --force only to overwrite an existing repo
```

## Option 3 — From the bundle (full snapshot, anywhere)
```bash
git clone "SPARX STUDIOS/sparx.bundle" sparx
cd sparx
git remote set-url origin https://github.com/<your-username>/sparx.git
git push -u origin main
```

## After pushing — one-time setup
```bash
npm install
npx playwright install chromium
cp .env.example .env             # add your keys (Supabase, Anthropic, Runway, HeyGen, ElevenLabs, YouTube)
npm test                         # 26 tests
npm run demo                     # full pipeline
```
