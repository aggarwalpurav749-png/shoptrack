// Search photos on the internet by product name (Pexels and/or Pixabay free APIs).
// The API keys stay on the server - the browser never sees them.
const router = require('express').Router();
const { z } = require('zod');
const cfg = require('../config');
const { wrap } = require('../utils/http');
const { validate } = require('../middleware/validate');
const { adminOnly } = require('../middleware/auth');

router.use(...adminOnly);

async function searchPexels(q) {
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=15`, {
    headers: { Authorization: cfg.pexelsKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Pexels answered ${r.status}`);
  const j = await r.json();
  return (j.photos || []).map((p) => ({
    id: `pexels-${p.id}`,
    thumb: p.src.medium || p.src.small,
    full: p.src.large || p.src.original,
    source: 'Pexels',
    credit: p.photographer || '',
  }));
}

async function searchPixabay(q) {
  const r = await fetch(
    `https://pixabay.com/api/?key=${encodeURIComponent(cfg.pixabayKey)}&q=${encodeURIComponent(q)}&image_type=photo&per_page=15&safesearch=true`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!r.ok) throw new Error(`Pixabay answered ${r.status}`);
  const j = await r.json();
  return (j.hits || []).map((h) => ({
    id: `pixabay-${h.id}`,
    thumb: h.webformatURL,
    full: h.largeImageURL || h.webformatURL,
    source: 'Pixabay',
    credit: h.user || '',
  }));
}

// Free, no key needed: Openverse (open-licensed photos) and Wikimedia Commons.
async function searchOpenverse(q) {
  const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=15&mature=false`, {
    headers: { 'User-Agent': 'ShopTrack/1.0 (shop catalog)', Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Openverse answered ${r.status}`);
  const j = await r.json();
  return (j.results || [])
    .filter((p) => p.url && /^https?:/.test(p.url))
    .map((p) => ({
      id: `openverse-${p.id}`,
      thumb: p.thumbnail || p.url,
      full: p.url,
      source: 'Openverse',
      credit: p.creator || '',
    }));
}

async function searchWikimedia(q) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=15&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=600&format=json' +
    `&gsrsearch=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'ShopTrack/1.0 (shop catalog)' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Wikimedia answered ${r.status}`);
  const j = await r.json();
  const pages = Object.values((j.query && j.query.pages) || {});
  return pages
    .map((p) => (p.imageinfo && p.imageinfo[0]) || null)
    .filter((i) => i && /^image\/(jpeg|png|webp)$/.test(i.mime || ''))
    .map((i, n) => ({
      id: `wikimedia-${n}-${(i.url || '').slice(-24)}`,
      thumb: i.thumburl || i.url,
      full: i.thumburl || i.url, // 600px version is plenty for a product photo
      source: 'Wikimedia',
      credit: '',
    }));
}

router.get(
  '/search',
  validate(z.object({ q: z.string().trim().min(2, 'Type at least 2 letters').max(80) }), 'query'),
  wrap(async (req, res) => {
    const { q } = req.valid.query;
    // Pexels / Pixabay (better stock photos) are used when a key is set; the free sources always work.
    const jobs = [];
    if (cfg.pexelsKey) jobs.push(searchPexels(q));
    if (cfg.pixabayKey) jobs.push(searchPixabay(q));
    jobs.push(searchOpenverse(q), searchWikimedia(q));
    const settled = await Promise.allSettled(jobs);
    const lists = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    if (!lists.length) {
      return res.status(502).json({ error: 'Image search is not answering right now. Please try again in a minute.', code: 'SEARCH_FAILED' });
    }
    // interleave results when both providers answered
    const items = [];
    const longest = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) items.push(l[i]);
    res.json({ items, configured: true });
  })
);

module.exports = router;
