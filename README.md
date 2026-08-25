# Penawdau Cymru

A small static site pairing daily Welsh news headlines with English translations, built for learning Welsh vocabulary while reading real news. Live at <https://garethj.github.io/welsh-news/>.

## How it works

Headlines come from [BBC Cymru Fyw](https://www.bbc.co.uk/cymrufyw)'s RSS feed. A GitHub Actions workflow (`.github/workflows/fetch-headlines.yml`) runs every few hours, fetches the feed, translates any new headlines via [MyMemory](https://mymemory.translated.net/) (a free, keyless translation API), and commits the result to `data/latest.json`. The site itself is fully static — no API keys or server involved, so it's just HTML/CSS/JS served by GitHub Pages.

**Which headlines are shown:** always today's top 5 (by feed position) merged with anything fetched more recently, deduplicated. This is stateless — no per-visit tracking — so it looks the same whether you open it on your phone or your laptop.

**Word-level translation:** tap any single word, in either language, to see its translation. Those glosses are precomputed offline in both directions for the headlines currently on display, so a tap is instant. Drag-select a phrase instead for a live translation of that phrase — this happens on demand rather than being precomputed, since covering every possible word combination up front isn't worth the added daily translation volume for a feature used only occasionally.

## Known limitations

- Translation is machine-generated (MyMemory), not human-reviewed. Full-sentence translations read reasonably well; isolated single-word translations are noisier, since MyMemory is a translation-memory search rather than a dictionary. A small hardcoded table covers Welsh's closed class of function words (articles, prepositions, common pronouns), and a heuristic (discard self-matching candidates, prefer the shortest remaining high-confidence one) improves single content-word lookups — but occasional bad translations still get through.
- No category filtering yet (e.g. excluding sport) — the feed doesn't carry category metadata, so this would need keyword-based filtering. See `EXCLUDED_KEYWORDS` in `scripts/fetch-and-translate.js`.

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
