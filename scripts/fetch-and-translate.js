#!/usr/bin/env node
// Fetches BBC Cymru Fyw headlines, translates any new ones via MyMemory
// (free, keyless), and writes data/latest.json. Safe to run repeatedly —
// already-translated headlines are cached and never re-translated.

import fs from 'node:fs/promises';

const FEED_URL = 'https://feeds.bbci.co.uk/cymrufyw/rss.xml';
const DATA_PATH = new URL('../data/latest.json', import.meta.url);
const TIMEZONE = 'Europe/London';

// Welsh keywords to exclude by default, e.g. add 'pêl-droed', 'rygbi',
// 'chwaraeon' here to filter out sport headlines. Matched case-insensitively
// against the Welsh title. Empty by default — no filtering yet.
const EXCLUDED_KEYWORDS = [];

function todayString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
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

async function translate(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=cy|en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const json = await res.json();
  const translated = json?.responseData?.translatedText;
  if (!translated) throw new Error('No translation returned');
  return translated;
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
      english = await translate(item.title);
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
