#!/usr/bin/env node
// Fetches BBC Cymru Fyw headlines, translates any new ones via MyMemory
// (free, keyless), and writes data/latest.json. Safe to run repeatedly —
// already-translated headlines are cached and never re-translated.
//
// Headlines that make today's display set (see pick-headlines.js) also get
// per-word glosses precomputed in both directions, so the front end can
// show a translation for any single word you tap without a live API call.
// Multi-word selections are translated live instead — precomputing every
// possible word combination would multiply daily translation volume for a
// feature used only occasionally.

import fs from 'node:fs/promises';
import { words } from '../tokenize.js';
import { pickDisplaySet } from '../pick-headlines.js';

const FEED_URL = 'https://feeds.bbci.co.uk/cymrufyw/rss.xml';
const DATA_PATH = new URL('../data/latest.json', import.meta.url);
const TIMEZONE = 'Europe/London';

// Welsh keywords to exclude by default, e.g. add 'pêl-droed', 'rygbi',
// 'chwaraeon' here to filter out sport headlines. Matched case-insensitively
// against the Welsh title. Empty by default — no filtering yet.
const EXCLUDED_KEYWORDS = [];

// MyMemory is a translation-memory search, not a dictionary: asked for a
// single common Welsh function word in isolation, it often returns a
// high-"match"-score but nonsensical fragment (e.g. "ei" -> "and its not
// the blackbird") because those words appear ambiguously in countless
// unrelated stored segments. Content words translate fine (verified against
// real headlines), and English function words translate fine in the
// opposite direction too — this is specifically a Welsh-source, short/
// closed-class-word problem, so a small hardcoded table for Welsh's
// grammatical words (a fixed, well-known set) sidesteps it entirely.
const CY_FUNCTION_WORDS = new Map(
  Object.entries({
    y: 'the', yr: 'the', r: 'the',
    a: 'and', ac: 'and',
    i: 'to',
    o: 'of',
    yn: 'in', n: 'in',
    ar: 'on',
    am: 'for',
    at: 'towards',
    gan: 'by',
    wrth: 'by',
    dan: 'under',
    dros: 'over',
    trwy: 'through', drwy: 'through',
    rhwng: 'between',
    heb: 'without',
    wedi: 'after',
    cyn: 'before',
    os: 'if',
    er: 'although',
    bod: 'to be', fod: 'to be',
    mae: 'is',
    oedd: 'was',
    bydd: 'will be', fydd: 'will be',
    yw: 'is', ydy: 'is',
    sy: 'which is', sydd: 'which is',
    ddim: 'not',
    na: 'nor', nac: 'nor',
    neu: 'or',
    ond: 'but',
    felly: 'so',
    hefyd: 'also',
    eto: 'again',
    ei: 'his/her',
    eu: 'their',
    ein: 'our',
    dy: 'your',
    fy: 'my', m: 'my',
    ni: 'we/us',
    chi: 'you',
    fe: 'he', fo: 'he',
    hi: 'she',
    nhw: 'they',
    ai: 'is it...?',
  })
);

function todayString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const title = decodeEntities((block.match(/<title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/title>/s) || [])[1] || '');
    const link = (block.match(/<link>(.*?)<\/link>/s) || [])[1] || '';
    const guid = (block.match(/<guid[^>]*>(.*?)<\/guid>/s) || [])[1] || link;
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/s) || [])[1] || '';
    if (title && link) items.push({ title, link, guid, pubDate });
  }
  return items;
}

function isExcluded(title) {
  const lower = title.toLowerCase();
  return EXCLUDED_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

async function fetchMatches(text, langpair) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  return res.json();
}

async function translate(text, langpair) {
  const json = await fetchMatches(text, langpair);
  const translated = json?.responseData?.translatedText;
  if (!translated) throw new Error('No translation returned');
  return translated;
}

// For single words, MyMemory's top-ranked "match" score isn't reliable —
// it's a translation-memory search, and short/common words show up
// ambiguously across countless unrelated stored segments (verified: "Cymru"
// top-ranked as "Ipiales", a Colombian city, with "Wales" sitting right
// there in the candidate list at almost the same score). Filtering out
// candidates identical to the source word (usually a bad memory hit) and
// preferring the shortest remaining high-confidence candidate consistently
// picked the correct answer in testing against real headline words.
async function translateWord(text, langpair) {
  const json = await fetchMatches(text, langpair);
  const src = text.trim().toLowerCase();
  const candidates = (json?.matches || [])
    .filter((m) => m.match >= 0.85 && m.translation.trim().toLowerCase() !== src)
    .sort((a, b) => a.translation.trim().length - b.translation.trim().length);

  if (candidates[0]) return candidates[0].translation.trim();

  const fallback = json?.responseData?.translatedText;
  if (!fallback) throw new Error('No translation returned');
  return fallback;
}

async function glossWords(text, langpair, overrides) {
  const glosses = [];
  for (const word of words(text)) {
    const override = overrides?.get(word.toLowerCase());
    if (override) {
      glosses.push(override);
      continue;
    }
    try {
      glosses.push(await translateWord(word, langpair));
    } catch (err) {
      console.error(`Word translation failed for "${word}":`, err.message);
      glosses.push('');
    }
    await sleep(100);
  }
  return glosses;
}

async function loadExisting() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data.date === todayString()) return data;
  } catch {
    // No existing file yet, or it's stale from a previous day — start fresh.
  }
  return { date: todayString(), headlines: [] };
}

async function main() {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  const xml = await res.text();
  const items = parseRss(xml).filter((item) => !isExcluded(item.title));

  const data = await loadExisting();
  const existingByGuid = new Map(data.headlines.map((h) => [h.guid, h]));

  const now = new Date().toISOString();
  const merged = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const existing = existingByGuid.get(item.guid);
    if (existing) {
      merged.push(existing);
      continue;
    }

    let english;
    try {
      english = await translate(item.title, 'cy|en');
    } catch (err) {
      console.error(`Translation failed for "${item.title}":`, err.message);
      continue;
    }

    merged.push({
      guid: item.guid,
      welsh: item.title,
      english,
      url: item.link,
      pubDate: item.pubDate,
      feedPosition: i,
      fetchedAt: now,
      category: null,
    });
  }

  const displaySet = pickDisplaySet({ headlines: merged });
  for (const h of displaySet) {
    if (!h.welshGlosses) {
      h.welshGlosses = await glossWords(h.welsh, 'cy|en', CY_FUNCTION_WORDS);
    }
    if (!h.englishGlosses) {
      h.englishGlosses = await glossWords(h.english, 'en|cy');
    }
  }

  data.headlines = merged;
  data.generatedAt = now;

  await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${data.headlines.length} headlines to data/latest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
