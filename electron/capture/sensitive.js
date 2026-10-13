// Heuristics that flag captured text which looks like a secret, so the user
// can review it before saving. Nothing is blocked or sent anywhere.

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const CHECKS = [
  ['a password', /\b(password|passwd|pwd|passcode|passphrase)\s*[:=]\s*\S+/i],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an API key or access token', /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/],
  ['a card security code', /\b(cvv|cvc|cvv2|security code)\s*[:=]?\s*\d{3,4}\b/i],
];

function sensitiveWarnings(text) {
  const s = String(text || '');
  const found = CHECKS.filter(([, re]) => re.test(s)).map(([label]) => label);
  for (const m of s.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) { found.push('a payment card number'); break; }
  }
  return found;
}

module.exports = { sensitiveWarnings, luhn };
