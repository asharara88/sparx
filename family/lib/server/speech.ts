/**
 * The app's voice: ElevenLabs text to speech, a warm female voice in English, Arabic
 * and Russian alike (the multilingual model reads whatever language the text is in).
 * ELEVENLABS_API_KEY on the server switches it on; without it the phone's own voice
 * speaks (lib/voice.ts). ELEVENLABS_VOICE_ID and ELEVENLABS_MODEL change the voice and
 * the model; eleven_flash_v2_5 uses half the credits of the default.
 */

/** "Matilda", one of ElevenLabs' own voices: warm, friendly, female. */
const DEFAULT_VOICE = "XrExE9yKIg1WjnnlVkGX";
const DEFAULT_MODEL = "eleven_multilingual_v2";
/** Longer than any answer the app reads out; a cap on what one tap can spend. */
export const SPEECH_MAX_CHARS = 1200;

export function speechKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY || undefined;
}

/** The text as it will be sent: trimmed, citation markers out, capped. */
export function speechText(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\[[a-z]+:[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SPEECH_MAX_CHARS);
}

/** ElevenLabs' answer: an MP3 stream, or the error it gave. */
export async function elevenSpeech(text: string, signal?: AbortSignal): Promise<Response> {
  const key = speechKey();
  if (!key) throw new Error("not_configured");
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || DEFAULT_MODEL,
      // Steady and soft, a little slower than talking speed: someone reading to a tired parent.
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true, speed: 0.95 },
    }),
    signal,
  });
}
