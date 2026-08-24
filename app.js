const TIMEZONE = 'Europe/London';
const TOP_COUNT = 5;
const EXTRA_COUNT = 3;

async function loadHeadlines() {
  const res = await fetch('data/latest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load headlines');
  return res.json();
}

// Stateless by design: always top headlines merged with anything freshly
// fetched, deduplicated. No per-device visit tracking, so it looks the same
// on your phone and laptop regardless of which you opened first today.
function pickHeadlines(data) {
  const headlines = data.headlines || [];
  const byPosition = [...headlines].sort((a, b) => a.feedPosition - b.feedPosition);
  const byRecency = [...headlines].sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));

  const top = byPosition.slice(0, TOP_COUNT);
  const seen = new Set(top.map((h) => h.guid));
  const extra = byRecency.filter((h) => !seen.has(h.guid)).slice(0, EXTRA_COUNT);

  return [...top, ...extra];
}

function render(headlines, generatedAt) {
  const list = document.getElementById('headlines');
  list.innerHTML = '';

  if (headlines.length === 0) {
    list.innerHTML = '<li class="error">No headlines available.</li>';
    return;
  }

  for (const h of headlines) {
    const li = document.createElement('li');
    li.className = 'headline';

    const a = document.createElement('a');
    a.className = 'welsh';
    a.href = h.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = h.welsh;

    const p = document.createElement('p');
    p.className = 'english';
    p.textContent = h.english;

    li.append(a, p);
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

loadHeadlines()
  .then((data) => render(pickHeadlines(data), data.generatedAt))
  .catch((err) => {
    document.getElementById('headlines').innerHTML = `<li class="error">${err.message}</li>`;
  });
