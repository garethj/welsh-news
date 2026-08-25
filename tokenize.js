// Splits text into word and non-word (punctuation/whitespace) tokens,
// preserving exact reconstruction. Shared between the fetch script (Node)
// and the front end (browser) so word indices always line up with the
// precomputed gloss arrays.

const WORD_CHARS = "A-Za-z0-9À-ÖØ-öø-ÿŵŴŷŶ";
// An apostrophe/hyphen only joins two word segments when followed by
// another letter — this stops a trailing quotation mark ("sylweddol'")
// or a leading one ("'Eicon'") from being absorbed into the word, while
// still keeping genuine contractions like "gynyddu'n" as one token.
const WORD_RE = new RegExp(`[${WORD_CHARS}]+(?:['’-][${WORD_CHARS}]+)*`, 'g');

export function tokenize(text) {
  const tokens = [];
  let lastIndex = 0;
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, m.index), isWord: false });
    }
    tokens.push({ text: m[0], isWord: true });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), isWord: false });
  }
  return tokens;
}

export function words(text) {
  return tokenize(text)
    .filter((t) => t.isWord)
    .map((t) => t.text);
}
