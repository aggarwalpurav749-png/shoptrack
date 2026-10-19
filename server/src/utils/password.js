const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ROUNDS = 10; // bcryptjs is pure JS; 10 keeps login fast on a phone (Termux)

const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

// A real hash compared against when the e-mail does not exist, so response time does not reveal valid e-mails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', ROUNDS);

/** Readable one-time password such as "Kd7mPq4xWz" - always has a letter and a digit. */
function generateTempPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz'; // no I, O, l (look-alikes)
  const digits = '23456789';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(letters), pick(digits), pick(digits)];
  while (chars.length < 10) chars.push(pick(letters + digits));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { hashPassword, checkPassword, DUMMY_HASH, generateTempPassword };
