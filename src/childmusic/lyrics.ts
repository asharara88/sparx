// Lyrics scaffolding (§7) — GENERATIVE WITHIN TEMPLATES.
//
// Emits a structural lyric plan (section tags + template lines + per-language
// guidance) rather than final polished lyrics: the downstream generator/LLM
// fills the slots. The STRUCTURE is what carries the developmental value —
// repetition and predictable fill-in-the-blank slots feed statistical learning;
// call-and-response leverages engagement; phonological patterning targets
// specific sounds. Bilingual requests are kept in SEPARATE sections (no
// within-line code-mixing) to preserve target-language phoneme clarity.
//
// Non-primary languages are emitted as write-in instructions rather than
// fabricated foreign text, so nothing here invents (possibly wrong) Arabic/other
// lyrics — the generation step produces the real lines in-language.

import type { Goal, Intent, LangTag, LyricPlan, LyricSection, StageId } from './types.js';

const LANG_NAME: Record<string, string> = { en: 'English', ar: 'Arabic' };
function langName(tag: LangTag): string {
  return LANG_NAME[tag.toLowerCase().slice(0, 2)] ?? tag;
}

/** Build the section list for one language in the given goal's shape. English
 *  (or the primary language) gets example template lines; other languages get a
 *  parallel write-in instruction mirroring the same structure. */
function sectionsFor(goal: Goal, lang: LangTag, isPrimary: boolean): LyricSection[] {
  const write = (structure: string, exampleEn: string): string =>
    isPrimary && lang.toLowerCase().startsWith('en')
      ? exampleEn
      : `(write in ${langName(lang)}: ${structure})`;

  switch (goal) {
    case 'sleep':
    case 'feeding':
      return [
        { tag: '[Intro]', text: '(soft hum, no words)', lang },
        { tag: '[Verse]', text: write('one short soothing line, repeated on the same descending melody', 'Hush now, little one, close your eyes'), lang },
        { tag: '[Verse]', text: write('repeat the same line — high repetition, predictable', 'Hush now, little one, close your eyes'), lang },
        { tag: '[Outro]', text: '(soft fade-out, gentle hum)', lang },
      ];
    case 'calm':
      return [
        { tag: '[Verse]', text: write('a calm, predictable line naming what the caregiver is doing', 'I am right here, holding you close'), lang },
        { tag: '[Chorus]', text: write('a short repeated reassurance, looped', 'Breathe in slow, breathe out slow'), lang },
        { tag: '[Outro]', text: '(settle into a soft, steady loop)', lang },
      ];
    case 'play':
      return [
        { tag: '[Verse]', text: write('call-and-response: caregiver names an action, leaves a beat for the child', 'Clap your hands (and… clap!)'), lang },
        { tag: '[Chorus]', text: write('a short movement phrase, repeated with a strong downbeat', 'Up and down, round and round'), lang },
        { tag: '[Verse]', text: write('another action, same call-and-response shape', 'Stomp your feet (and… stomp!)'), lang },
      ];
    case 'focus':
      return [
        { tag: '[Chorus]', text: write('the core target phrase or word, repeated clearly', 'This is the ___ (name the object)'), lang },
        { tag: '[Verse]', text: write('a fill-in-the-blank slot with a predictable rhyme/alliteration on the target sound', 'The cat sat on the ___'), lang },
        { tag: '[Chorus]', text: write('repeat the core phrase — leverage statistical learning', 'This is the ___ (name the object)'), lang },
      ];
    case 'entertain':
      return [
        { tag: '[Verse]', text: write('open a small, silly, singable story', 'A little duck went for a walk'), lang },
        { tag: '[Chorus]', text: write('a catchy repeated hook, easy to sing along', 'Waddle waddle, quack quack quack!'), lang },
        { tag: '[Verse]', text: write('a playful twist in the story', 'The duck found a puddle to splash'), lang },
        { tag: '[Outro]', text: write('warm, joyful close', 'Home again, home again, quack!'), lang },
      ];
  }
}

function guidanceFor(goal: Goal, stage: StageId, languages: LangTag[]): string[] {
  const g: string[] = [];
  // Universal §7a developmental scaffolding.
  g.push('High-frequency core vocabulary; concrete nouns/verbs tied to routines (eat, sleep, wave).');
  g.push('Heavy repetition and predictable fill-in-the-blank slots; call-and-response leverages statistical learning.');
  g.push('Infant-directed prosody: higher pitch, slower, exaggerated contour.');

  if (goal === 'focus') {
    g.push('Phonological patterning: rhyme, alliteration, syllable emphasis; target specific phonemes/minimal pairs for the child’s language.');
    g.push('Songs boost engagement but spoken input may teach vocabulary as well or better — do not rely on song alone for depth (Morini & Blair 2021).');
  }
  if (stage === '3-4yr' || stage === '4-6yr') {
    g.push('Phonological awareness (3–6 yr): clap syllables, onset-rime and rhyming games.');
  }
  if (stage === '6-12mo') {
    g.push('Sensitive window: prioritize the target native language; keep phonemes clear.');
  }

  // Bilingual handling (§7a) — the load-bearing rule.
  const distinct = new Set(languages.map((l) => l.toLowerCase().slice(0, 2)));
  if (distinct.size >= 2) {
    g.push('Bilingual: keep languages in SEPARATE songs or clearly separated sections — avoid within-line code-mixing to preserve target-language phoneme clarity.');
    g.push('Pair with caregiver interaction. Exposure to both languages helps (Strong); do NOT claim songs accelerate bilingual acquisition (Contested; Arabic/English early-childhood evidence is absent).');
  }
  return g;
}

export function planLyrics(input: {
  goal: Goal;
  intent: Intent;
  stage: StageId;
  languages: LangTag[];
  instrumental?: boolean;
}): LyricPlan {
  const languages = input.languages.length ? input.languages : ['en'];

  if (input.instrumental) {
    return {
      instrumental: true,
      sections: [{ tag: '[Instrumental]', text: '(no lyrics — instrumental bed)', lang: languages[0]! }],
      guidance: ['Instrumental only — no vocals. Note that sung infant-directed delivery beats instrumental for attention and bonding (§5); reserve instrumental for a background bed.'],
      languages,
    };
  }

  // One block of sections per language, primary first, never mixed within a line.
  const sections: LyricSection[] = [];
  languages.forEach((lang, i) => {
    sections.push(...sectionsFor(input.goal, lang, i === 0));
  });

  const guidance = input.intent === 'entertainment'
    ? [
        'Entertainment track: joy, play, silliness/humor, narrative arcs, bonding themes, cultural resonance.',
        'Prioritize engagement, singability, and age-appropriate content. No developmental claims required.',
      ]
    : guidanceFor(input.goal, input.stage, languages);

  return { instrumental: false, sections, guidance, languages };
}
