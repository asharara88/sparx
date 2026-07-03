# Render worker image (Railway). Runs the always-on queue drainer that executes the
# minutes-long ffmpeg pipeline Vercel can't. Node 20 + ffmpeg + a font for burned captions.
FROM node:20-slim

# ffmpeg/ffprobe for rendering; a DejaVu font so drawtext has a glyph set (see
# FONT_CANDIDATES in src/media/render.ts); ca-certificates for provider HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching. The worker runs TypeScript via tsx, so dev
# deps are needed at runtime — install everything.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The worker requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY plus the provider keys
# (HEYGEN_API_KEY, ELEVENLABS_API_KEY, RUNWAY_API_KEY, ANTHROPIC_API_KEY, …) as env vars.
CMD ["npm", "run", "worker"]
