import { tokenize } from './tokenize.js';
import { pickDisplaySet } from './pick-headlines.js';

const TIMEZONE = 'Europe/London';

let headlinesByGuid = new Map();
let popupEl = null;

async function loadHeadlines() {
  const res = await fetch('data/latest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load headlines');
  return res.json();
}

function renderWordSpans(text, lang) {
  const frag = document.createDocumentFragment();
  let wordIdx = 0;
  for (const t of tokenize(text)) {
    if (t.isWord) {
      const span = document.createElement('span');
      span.className = 'w-word';
      span.dataset.lang = lang;
      span.dataset.widx = String(wordIdx);
      span.textContent = t.text;
      frag.appendChild(span);
      wordIdx++;
    } else {
      frag.appendChild(document.createTextNode(t.text));
    }
  }
  return frag;
}

function render(headlines, generatedAt) {
  const list = document.getElementById('headlines');
  list.innerHTML = '';
  headlinesByGuid = new Map(headlines.map((h) => [h.guid, h]));

  if (headlines.length === 0) {
    list.innerHTML = '<li class="error">No headlines available.</li>';
    return;
  }

  for (const h of headlines) {
    const li = document.createElement('li');
    li.className = 'headline';
    li.dataset.guid = h.guid;

    const row = document.createElement('div');
    row.className = 'welsh-row';

    const welshText = document.createElement('span');
    welshText.className = 'welsh-text';
    welshText.appendChild(renderWordSpans(h.welsh, 'cy'));

    const link = document.createElement('a');
    link.className = 'source-link';
    link.href = h.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '(link)';

    row.append(welshText, link);

    const p = document.createElement('p');
    p.className = 'english';
    p.appendChild(renderWordSpans(h.english, 'en'));

    li.append(row, p);
    list.appendChild(li);
  }

  const updated = document.getElementById('updated');
  updated.textContent = generatedAt
    ? `Updated ${new Date(generatedAt).toLocaleTimeString('en-GB', {
        timeZone: TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : '';
}

function ensurePopup() {
  if (popupEl) return popupEl;
  popupEl = document.createElement('div');
  popupEl.className = 'popup';
  popupEl.hidden = true;
  document.body.appendChild(popupEl);
  return popupEl;
}

function showPopup(rect, text) {
  const popup = ensurePopup();
  popup.textContent = text;
  popup.hidden = false;

  const popupRect = popup.getBoundingClientRect();
  let top = rect.bottom + 8;
  if (top + popupRect.height > window.innerHeight - 8) {
    top = rect.top - popupRect.height - 8;
  }
  let left = rect.left;
  if (left + popupRect.width > window.innerWidth - 8) {
    left = window.innerWidth - popupRect.width - 8;
  }
  if (left < 8) left = 8;
  if (top < 8) top = 8;

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

function closePopup() {
  if (popupEl) popupEl.hidden = true;
}

function handleWordClick(wordEl) {
  const li = wordEl.closest('.headline');
  const h = headlinesByGuid.get(li.dataset.guid);
  const lang = wordEl.dataset.lang;
  const idx = Number(wordEl.dataset.widx);
  const glosses = lang === 'cy' ? h.welshGlosses : h.englishGlosses;
  const gloss = glosses ? glosses[idx] : undefined;
  showPopup(wordEl.getBoundingClientRect(), gloss || 'No translation available');
}

async function liveTranslate(text, langpair) {
  const key = `mt:${langpair}:${text.toLowerCase()}`;
  const cached = sessionStorage.getItem(key);
  if (cached) return cached;

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Translation request failed');
  const json = await res.json();
  const translated = json?.responseData?.translatedText;
  if (!translated) throw new Error('No translation returned');

  sessionStorage.setItem(key, translated);
  return translated;
}

async function handleSelection(selection) {
  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (!text) return;

  const anchorNode = range.commonAncestorContainer;
  const anchorEl = anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement;
  const block = anchorEl ? anchorEl.closest('.welsh-text, .english') : null;
  if (!block) return;

  const lang = block.classList.contains('welsh-text') ? 'cy' : 'en';
  const langpair = lang === 'cy' ? 'cy|en' : 'en|cy';
  const rect = range.getBoundingClientRect();

  showPopup(rect, 'Translating…');
  try {
    const translation = await liveTranslate(text, langpair);
    showPopup(rect, translation);
  } catch {
    showPopup(rect, 'Translation unavailable');
  }
  selection.removeAllRanges();
}

document.addEventListener('click', (e) => {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim().length > 1) {
    handleSelection(selection);
    return;
  }

  const wordEl = e.target.closest('.w-word');
  if (wordEl) {
    handleWordClick(wordEl);
    return;
  }

  if (!e.target.closest('.popup')) {
    closePopup();
  }
});

loadHeadlines()
  .then((data) => render(pickDisplaySet(data), data.generatedAt))
  .catch((err) => {
    document.getElementById('headlines').innerHTML = `<li class="error">${err.message}</li>`;
  });
