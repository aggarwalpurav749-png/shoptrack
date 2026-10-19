const cfg = require('../config');

const hm = new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, hour: '2-digit', minute: '2-digit', hour12: false });

/** HH:MM of a moment in the shop's timezone. */
function hhmmAt(date = new Date()) {
  const parts = hm.formatToParts(date);
  const h = parts.find((p) => p.type === 'hour').value.replace('24', '00');
  return `${h}:${parts.find((p) => p.type === 'minute').value}`;
}

const withinHours = (h, hhmm) => hhmm >= h.start && hhmm <= h.end;

module.exports = { hhmmAt, withinHours };
