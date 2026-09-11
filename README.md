# Penawdau Cymru

A small static site pairing daily Welsh news headlines with English translations, built for learning Welsh vocabulary while reading real news. Live at <https://garethj.github.io/welsh-news/>.

## How it works

Headlines come from [Golwg360](https://golwg.360.cymru)'s News section feed, which mixes Wales, UK and international news (as opposed to their full-site feed, which also carries sport/culture/lifestyle). A GitHub Actions workflow (`.github/workflows/fetch-headlines.yml`) runs every few hours, fetches the feed, translates any new headlines via [MyMemory](https://mymemory.translated.net/) (a free, keyless translation API), and commits the result to `data/latest.json`. The site itself is fully static — no API keys or server involved, so it's just HTML/CSS/JS served by GitHub Pages.

Opinion pieces and audio/podcast features, which Golwg360 marks with a 🗣 or 🔊 emoji prefix rather than a distinguishing RSS category, are filtered out so only straight news headlines are shown.

**Which headlines are shown:** always today's top 5 (by feed position) merged with anything fetched more recently, deduplicated. This is stateless — no per-visit tracking — so it looks the same whether you open it on your phone or your laptop.

**Word-level translation:** tap any single word, in either language, to see its translation. Those glosses are precomputed offline in both directions for the headlines currently on display, so a tap is instant — no live API call from the browser. The tapped word stays highlighted while its popup is open, which is what makes the selection visible on a touchscreen, where there's no hover state.

## Known limitations

- Translation is machine-generated (MyMemory), not human-reviewed. Full-sentence translations read reasonably well; isolated single-word translations are noisier, since MyMemory is a translation-memory search rather than a dictionary. A small hardcoded table covers Welsh's closed class of function words (articles, prepositions, common pronouns), and a heuristic (discard self-matching candidates, prefer the shortest remaining high-confidence one) improves single content-word lookups — but occasional bad translations still get through.
- The Welsh headlines themselves are genuine journalism, written directly in Welsh by Golwg360's own reporters — not machine-translated.
- No keyword-based category filtering is configured (e.g. excluding sport) — `EXCLUDED_KEYWORDS` in `scripts/fetch-and-translate.js` is empty by default, since the News feed already excludes sport/culture at source.

## Local development

Requires Node 18+ (uses the built-in `fetch`).

```bash
node scripts/fetch-and-translate.js   # refresh data/latest.json
python3 -m http.server 8000           # serve the site locally
```

Then open `http://localhost:8000/`.

## Project layout

- `scripts/fetch-and-translate.js` — fetches the feed, translates headlines and words, writes `data/latest.json`
- `tokenize.js`, `pick-headlines.js` — logic shared between the fetch script (Node) and the front end (browser)
- `index.html`, `app.js`, `style.css` — the site itself
- `.github/workflows/fetch-headlines.yml` — scheduled data refresh
