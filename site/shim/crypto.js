// node:crypto for the app's own console code on the public site: SHA-256 as text in, hex out (the Apply preview's basis). The browser's
// own digest is asynchronous and the app's call is not, so it is worked here; tests compare it with Node's.
const K = [];
const H0 = [];
for (let n = 2, found = 0; found < 64; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
  if (!prime) continue;
  K.push(Math.floor((n ** (1 / 3) % 1) * 2 ** 32));
  if (found < 8) H0.push(Math.floor((n ** (1 / 2) % 1) * 2 ** 32));
  found++;
}
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, bytes.length * 8);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor(bytes.length / 2 ** 29));
  const h = [...H0], w = new Array(64), view = new DataView(padded.buffer);
  for (let at = 0; at < padded.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
    }
    let [s0, s1, s2, s3, s4, s5, s6, s7] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (s7 + (rotr(s4, 6) ^ rotr(s4, 11) ^ rotr(s4, 25)) + ((s4 & s5) ^ (~s4 & s6)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(s0, 2) ^ rotr(s0, 13) ^ rotr(s0, 22)) + ((s0 & s1) ^ (s0 & s2) ^ (s1 & s2))) | 0;
      s7 = s6; s6 = s5; s5 = s4; s4 = (s3 + t1) | 0; s3 = s2; s2 = s1; s1 = s0; s0 = (t1 + t2) | 0;
    }
    [s0, s1, s2, s3, s4, s5, s6, s7].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

function createHash(kind) {
  if (kind !== "sha256") throw new Error(`Only sha256 is available on the public site, not ${kind}.`);
  let text = "";
  return { update(s) { text += s; return this; }, digest(enc) { if (enc !== "hex") throw new Error("Only hex digests are available on the public site."); return sha256Hex(text); } };
}

export default { createHash };
