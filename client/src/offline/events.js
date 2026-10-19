// Tiny publish / subscribe, so the pieces of the offline engine do not import each other in circles.
const subs = new Map();
export const on = (name, fn) => {
  if (!subs.has(name)) subs.set(name, new Set());
  subs.get(name).add(fn);
  return () => subs.get(name).delete(fn);
};
export const emit = (name, payload) => {
  (subs.get(name) || []).forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {
      /* a listener must never break the sender */
    }
  });
};
