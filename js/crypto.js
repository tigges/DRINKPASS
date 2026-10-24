// Password-protected backups: PBKDF2-SHA-256 key derivation and AES-256-GCM, all via Web Crypto.
var ITERATIONS = 310000;
var enc = new TextEncoder(), dec = new TextDecoder();

function toB64(buf) { var s = '', b = new Uint8Array(buf); for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function fromB64(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
function deriveKey(password, salt, iterations, usage) {
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iterations }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
  });
}

export function isEncryptedBackup(d) { return !!(d && d.app === 'drink-pass-journal' && d.encrypted === 1 && d.data && d.salt && d.iv); }

export function encryptBackup(text, password) {
  var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  return deriveKey(password, salt, ITERATIONS, 'encrypt').then(function (key) {
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text));
  }).then(function (ct) {
    return JSON.stringify({ app: 'drink-pass-journal', encrypted: 1, cipher: 'AES-256-GCM', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS }, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) });
  });
}

/** Resolves with the plain backup text; rejects with { code: 'password' } when the password is wrong. */
export function decryptBackup(d, password) {
  var iterations = d.kdf && +d.kdf.iterations > 0 ? +d.kdf.iterations : ITERATIONS;
  return deriveKey(password, fromB64(d.salt), iterations, 'decrypt').then(function (key) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(d.iv) }, key, fromB64(d.data));
  }).then(function (pt) { return dec.decode(pt); }, function () { throw { code: 'password' }; });
}
