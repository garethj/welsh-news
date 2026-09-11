#!/usr/bin/env node
// Fetches Golwg360 headlines, translates any new ones via MyMemory
// (free, keyless), and writes data/latest.json. Safe to run repeatedly —
// already-translated headlines are cached and never re-translated.
//
// Headlines that make today's display set (see pick-headlines.js) also get
// per-word glosses precomputed in both directions, so the front end can
// show a translation for any single word you tap without a live API call.

import fs from 'node:fs/promises';
import { words } from '../tokenize.js';
import { pickDisplaySet } from '../pick-headlines.js';

// Golwg360's News section (as opposed to their full-site /ffrwd, which also
// carries sport/culture/lifestyle, or the narrower Rhyngwladol/Prydain/Cymru
// category feeds). This one mixes Cymru, Prydain (UK) and Rhyngwladol
// (international) news, human-written in Welsh by Golwg360's own journalists.
const FEED_URL = 'https://golwg.360.cymru/newyddion/ffrwd';
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

// MyMemory's langpair variant tag (en-GB vs en) doesn't actually change
// which candidates it offers — verified: "mam" offers both "Mother" and
// "mom" regardless. Rather than relying on MyMemory for dialect, swap the
// common American spellings/words for British ones after the fact. Only
// covers words with no sense-dependent split (e.g. "tire"/"practice" are
// deliberately excluded — British spelling depends on which meaning is in
// play, so a blind swap could introduce a wrong word instead of a dialect one).
const AMERICAN_TO_BRITISH = {
  mom: 'mum', mommy: 'mummy', moms: 'mums',
  color: 'colour', colors: 'colours', colored: 'coloured', coloring: 'colouring',
  favorite: 'favourite', favorites: 'favourites', favor: 'favour', favors: 'favours', favored: 'favoured',
  center: 'centre', centers: 'centres', centered: 'centred',
  theater: 'theatre', theaters: 'theatres',
  defense: 'defence', defenses: 'defences',
  offense: 'offence', offenses: 'offences',
  organize: 'organise', organizes: 'organises', organized: 'organised', organizing: 'organising',
  organization: 'organisation', organizations: 'organisations',
  realize: 'realise', realizes: 'realises', realized: 'realised', realizing: 'realising',
  analyze: 'analyse', analyzes: 'analyses', analyzed: 'analysed', analyzing: 'analysing',
  apologize: 'apologise', apologizes: 'apologises', apologized: 'apologised', apologizing: 'apologising',
  recognize: 'recognise', recognizes: 'recognises', recognized: 'recognised', recognizing: 'recognising',
  honor: 'honour', honors: 'honours', honored: 'honoured', honoring: 'honouring',
  labor: 'labour', labors: 'labours', labored: 'laboured',
  neighbor: 'neighbour', neighbors: 'neighbours', neighborhood: 'neighbourhood', neighborhoods: 'neighbourhoods',
  traveled: 'travelled', traveling: 'travelling', traveler: 'traveller', travelers: 'travellers',
  canceled: 'cancelled', canceling: 'cancelling',
  jewelry: 'jewellery',
  gray: 'grey',
  aluminum: 'aluminium',
  mustache: 'moustache', mustaches: 'moustaches',
  pajamas: 'pyjamas',
  math: 'maths',
  sulfur: 'sulphur',
  plow: 'plough', plows: 'ploughs', plowed: 'ploughed',
  liter: 'litre', liters: 'litres',
  fiber: 'fibre', fibers: 'fibres',
};
const AMERICAN_RE = new RegExp(`\\b(${Object.keys(AMERICAN_TO_BRITISH).join('|')})\\b`, 'gi');

function toBritish(text) {
  if (!text) return text;
  return text.replace(AMERICAN_RE, (match) => {
    const british = AMERICAN_TO_BRITISH[match.toLowerCase()];
    if (match === match.toUpperCase()) return british.toUpperCase();
    if (match[0] === match[0].toUpperCase()) return british[0].toUpperCase() + british.slice(1);
    return british;
  });
}

function todayString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// BBC's feed wraps text fields in CDATA; Golwg360's writes plain text with
// numeric HTML entities instead (e.g. &#8220; for a curly quote, &#038; for
// an ampersand in a link's query string) — both forms need handling since
// either feed shape might be in use.
function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractField(block, tag) {
  const match = block.match(
    new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${tag}>`)
  );
  if (!match) return '';
  return decodeEntities((match[1] ?? match[2] ?? '').trim());
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const title = extractField(block, 'title');
    const link = extractField(block, 'link');
    const guid = extractField(block, 'guid') || link;
    const pubDate = extractField(block, 'pubDate');
    if (title && link) items.push({ title, link, guid, pubDate });
  }
  return items;
}

function isExcluded(title) {
  const lower = title.toLowerCase();
  return EXCLUDED_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// Golwg360 prefixes non-news content types with a marker emoji instead of a
// distinguishing RSS category: 🗣 for opinion pieces ("Safbwynt") and 🔊 for
// audio/podcast features. Neither is straight news, so both get filtered out
// here rather than shown alongside real headlines.
const NON_NEWS_PREFIXES = ['🗣', '🔊'];

function isNonNewsPrefixed(title) {
  return NON_NEWS_PREFIXES.some((prefix) => title.startsWith(prefix));
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
      glosses.push(toBritish(override));
      continue;
    }
    try {
      glosses.push(toBritish(await translateWord(word, langpair)));
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
  const items = parseRss(xml).filter(
    (item) => !isExcluded(item.title) && !isNonNewsPrefixed(item.title)
  );

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
      english = toBritish(await translate(item.title, 'cy|en'));
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
