/**
 * 2026-10-22 tester call: "Tried giving a tough name to it like Sibohan
 * Okonkwo, also spelled it word by word, still it was not able to capture."
 *
 * Reading a spelling out of a transcript assumed one shape: single-letter
 * tokens in a row, "s i o b h a n". Real callers use two others, and both
 * defeated it completely.
 *
 * 1. "S for Sam, I for India" — the convention this platform's own prompt
 *    encourages ("read spellings back and ask callers to confirm them"),
 *    and which voice-runtime's fragment-detector already has to recognise
 *    for a separate reason. The words between the letters broke the run, so
 *    a name spelled this way produced NOTHING: not one letter.
 * 2. Letter NAMES, which is how speech recognition commonly writes spoken
 *    letters: "ess eye oh bee aitch ay en". Every token is a word, so again
 *    no run.
 *
 * Shape 1 is safe to read anywhere: "<single letter> for <word>" does not
 * occur in ordinary speech. Shape 2 is NOT -- "oh, are you able to come
 * today" would read as the letters O-R-U -- so letter names are only
 * honoured when Grace has actually asked the caller to spell something.
 * Outside that context they are left alone.
 */

/** "S for Sam", "I as in India", "B like Boy" -> the letter alone. */
const PHONETIC_LETTER = /\b([a-z])\s+(?:for|as in|like)\s+[a-z']+\b/gi;

const LETTER_NAMES: Record<string, string> = {
  ay: "a",
  aye: "a",
  bee: "b",
  cee: "c",
  see: "c",
  sea: "c",
  dee: "d",
  ee: "e",
  eff: "f",
  ef: "f",
  gee: "g",
  aitch: "h",
  haitch: "h",
  eye: "i",
  jay: "j",
  kay: "k",
  el: "l",
  ell: "l",
  em: "m",
  en: "n",
  oh: "o",
  owe: "o",
  pee: "p",
  cue: "q",
  queue: "q",
  ar: "r",
  are: "r",
  ess: "s",
  es: "s",
  tee: "t",
  tea: "t",
  yoo: "u",
  you: "u",
  vee: "v",
  ex: "x",
  why: "y",
  wye: "y",
  zee: "z",
  zed: "z",
};

/** Collapses "<letter> for <word>" spellings to the bare letter, leaving everything else alone. */
export function reducePhoneticSpelling(text: string): string {
  return text.replace(PHONETIC_LETTER, "$1 ");
}

/**
 * The one letter this token stands for, or null when it is an ordinary word.
 * `spellingAsked` gates letter NAMES only; a true single letter always counts.
 */
export function letterOf(token: string, spellingAsked: boolean): string | null {
  if (token.length === 1 && /[a-z]/.test(token)) {
    return token;
  }
  if (spellingAsked) {
    return LETTER_NAMES[token] ?? null;
  }
  return null;
}

/**
 * Every run of three or more letters the caller spelled out in this text, as
 * whole words. Empty when they were not spelling.
 */
export function spelledWordsIn(text: string, spellingAsked = false): string[] {
  const tokens = reducePhoneticSpelling(text)
    .toLowerCase()
    // Apostrophes close up rather than splitting the word. Splitting them
    // turned "it's s i o b h a n" into a stray "s" ahead of the spelling,
    // and the name came out as "ssiobhan" -- true of the shape this
    // replaces too, and a real way a careful spelling still came out wrong.
    .replace(/['’]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const words: string[] = [];
  let run = "";
  for (const token of tokens) {
    const letter = letterOf(token, spellingAsked);
    if (letter) {
      run += letter;
      continue;
    }
    if (run.length >= 3) {
      words.push(run);
    }
    run = "";
  }
  if (run.length >= 3) {
    words.push(run);
  }
  return words;
}
