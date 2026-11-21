/** Small client-side profanity / slur filter for user generated text (Turkish + English).
 * It is a first line of defence only: server rules and user reports remain the real moderation. */

const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿]/g;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/** Whole-word matches (after lower-casing, Turkish diacritics preserved). */
const EXACT = new Set([
  // Turkish
  'amk', 'aq', 'amq', 'sik', 'sikik', 'siktir', 'piç', 'orospu', 'oç', 'yarrak', 'yarak', 'ibne', 'puşt', 'kahpe',
  'şerefsiz', 'gavat', 'pezevenk', 'amcık', 'götveren', 'kaltak', 'sürtük', 'taşak',
  // English
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'slut', 'whore', 'nigger', 'nigga',
  'faggot', 'fag', 'retard', 'kys',
]);
/** Prefix matches for inflected forms (siktirgit, orospuçocuğu, fucking...). */
const STEMS = ['siktir', 'sikeyim', 'sikerim', 'sikik', 'orospu', 'yarrak', 'yarak', 'amcık', 'amcik', 'amına', 'amina', 'ananı', 'anani', 'götün', 'gotun', 'götveren', 'gotveren', 'pezevenk', 'şerefsiz', 'serefsiz', 'fuck', 'nigg', 'faggot', 'motherfuck', 'cunt', 'bitch', 'asshole', 'whore'];
/** Long, unambiguous terms also checked in the letter-squashed text to catch "s i k t i r" / "f.u.c.k". */
const SQUASHED = ['siktir', 'orospu', 'yarrak', 'amcik', 'pezevenk', 'fuck', 'nigger', 'faggot', 'bitch', 'cunt'];

function foldDiacritics(value: string): string {
  return value.replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
}

/** Returns the first offending word, or null when the text looks clean. */
export function findProfanity(input: string): string | null {
  if (!input) return null;
  const text = input.replace(ZERO_WIDTH, '').toLocaleLowerCase('tr-TR')
    .replace(/[0-9@$!]/g, (char) => LEET[char] ?? char);
  const tokens = text.split(/[^\p{L}]+/u).filter(Boolean);
  for (const token of tokens) {
    if (EXACT.has(token)) return token;
    const stem = STEMS.find((candidate) => token.startsWith(candidate));
    if (stem) return stem;
  }
  const squashed = foldDiacritics(text.replace(/[^\p{L}]+/gu, ''));
  const hit = SQUASHED.find((candidate) => squashed.includes(candidate));
  return hit ?? null;
}

/** Throws a Turkish error when the text contains blocked language. */
export function assertCleanText(value: string, label: string): void {
  if (findProfanity(value)) {
    throw new Error(`${label} uygunsuz ifadeler içeriyor. Lütfen düzenleyip tekrar dene.`);
  }
}
