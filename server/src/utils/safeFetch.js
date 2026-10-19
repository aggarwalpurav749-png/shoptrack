// Download an image from a URL the admin pasted / picked, without letting the server be
// tricked into reading private network addresses (SSRF).
const dns = require('dns').promises;
const net = require('net');
const { HttpError } = require('./http');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x)) return true; // unique-local, link-local
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new HttpError(400, 'That is not a valid image link', 'BAD_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new HttpError(400, 'Only normal http/https image links are allowed', 'BAD_URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch (e) {
    throw new HttpError(400, 'Could not find that website', 'BAD_URL');
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new HttpError(400, 'That image link is not allowed', 'BAD_URL');
  }
  return url;
}

async function downloadImage(rawUrl, { maxBytes = 8 * 1024 * 1024, timeoutMs = 15000 } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= 3; hop++) {
    const url = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetch(url, {
          redirect: 'manual', // every redirect hop is re-checked above
          signal: ctrl.signal,
          headers: { 'User-Agent': 'ShopTrack/1.0', Accept: 'image/*' },
        });
      } catch (e) {
        throw new HttpError(502, 'Could not download that image (website did not answer)', 'FETCH_FAILED');
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), url).toString();
        continue;
      }
      if (!res.ok) throw new HttpError(502, `Image website answered with error ${res.status}`, 'FETCH_FAILED');
      if (Number(res.headers.get('content-length') || 0) > maxBytes) {
        throw new HttpError(413, 'That image is too large (max 8 MB)', 'TOO_LARGE');
      }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > maxBytes) throw new HttpError(413, 'That image is too large (max 8 MB)', 'TOO_LARGE');
          chunks.push(chunk);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(502, 'Image download was interrupted', 'FETCH_FAILED');
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new HttpError(502, 'Too many redirects while downloading the image', 'FETCH_FAILED');
}

module.exports = { downloadImage, isPrivateIp };
