// Pattern highlights drawn on top of Tree-sitter's colours:
// - colour previews (#rrggbb, rgb(), hsl() shown on their own colour)
// - security indicators (IP, MAC and email addresses, URLs, registry
//   keys, wallet addresses, CVE/CWE and ATT&CK IDs, file hashes), for
//   security notes
//
// Self-contained and free of Obsidian, so it can be tested on its own (and
// reused elsewhere, for example in a Neovim plugin).

export interface PatternMatch {
  start: number;
  end: number;
  kind: string; // for example "colour", "ipv4", "cve"
  label: string; // shown on hover
  colour?: string; // colour previews: the colour as #rrggbb
  link?: { url: string; site: string }; // reference page for IDs
  marker?: string; // shown before the match (for example a warning sign or a name for an invisible character)
}

// ---------------------------------------------------------------------
// Colour previews

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** Convert HSL (h in degrees, s and l in 0..1) to #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${hex2(f(0) * 255)}${hex2(f(8) * 255)}${hex2(f(4) * 255)}`;
}

const num = (v: string, max: number) => (v.endsWith("%") ? (parseFloat(v) / 100) * max : parseFloat(v));

export function findColours(text: string): PatternMatch[] {
  const out: PatternMatch[] = [];
  const hexRe = /(?<![\w&#])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
  for (const m of text.matchAll(hexRe)) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    out.push({ start: m.index, end: m.index + m[0].length, kind: "colour", label: "Colour", colour: `#${h.slice(0, 6).toLowerCase()}` });
  }
  const fnRe = /\b(rgba?|hsla?)\(\s*([\d.]+(?:deg|%)?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)/gi;
  for (const m of text.matchAll(fnRe)) {
    const fn = m[1].toLowerCase();
    let colour: string;
    if (fn.startsWith("rgb")) {
      colour = `#${hex2(num(m[2], 255))}${hex2(num(m[3], 255))}${hex2(num(m[4], 255))}`;
    } else {
      colour = hslToHex(parseFloat(m[2]), num(m[3].endsWith("%") ? m[3] : m[3] + "%", 1), num(m[4].endsWith("%") ? m[4] : m[4] + "%", 1));
    }
    out.push({ start: m.index, end: m.index + m[0].length, kind: "colour", label: "Colour", colour });
  }
  return out;
}

/** Black or white text, whichever reads better on the colour. */
export function textOn(colour: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}

// ---------------------------------------------------------------------
// Security indicators

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const DOT = "(?:\\.|\\[\\.\\]|\\(\\.\\))"; // also defanged [.] and (.)
const H16 = "[0-9a-fA-F]{1,4}";

// File extensions that look like top-level domains in names like
// "logo@2x.png", so they are not email addresses
const FILE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "css", "js", "ts", "json", "py", "md", "txt", "html", "pdf", "zip"]);

const SECURITY: Array<{ kind: string; label: string; re: RegExp; check?: (s: string) => boolean }> = [
  {
    kind: "url", label: "URL",
    // brackets only as defanging ([.] and [:]), so a Markdown link's "]" is not swallowed
    re: /\b(?:https?|hxxps?|ftp|fxp)(?::|\[:\])\/\/(?:[^\s"'<>`()[\]]|\[\.\]|\[:\])+/gi,
  },
  {
    kind: "email", label: "Email address",
    // also defanged: [@], [at], [.]
    re: /(?<![\w.%+-])[A-Za-z0-9._%+-]+(?:@|\[@\]|\[at\])[A-Za-z0-9-]+(?:(?:\.|\[\.\])[A-Za-z0-9-]+)*(?:\.|\[\.\])[A-Za-z]{2,}\b/g,
    check: (s) => !FILE_EXT.has(s.slice(s.lastIndexOf(".") + 1).replace("]", "").toLowerCase()) || /\[\.\][a-z]+$/i.test(s),
  },
  {
    kind: "mac", label: "MAC address",
    // aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff (one separator throughout), aabb.ccdd.eeff
    re: /(?<![\w:.-])(?:[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4}|[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4})(?![\w:.-]*\w)/g,
    // the dotted form needs a letter, so numbers like 2024.1015.1200 never match
    check: (s) => !s.includes(".") || /[a-fA-F]/.test(s),
  },
  {
    kind: "registry", label: "Windows registry key",
    re: /\b(?:HKEY_(?:LOCAL_MACHINE|CURRENT_USER|CLASSES_ROOT|USERS|CURRENT_CONFIG)|HKLM|HKCU|HKCR|HKU|HKCC):?(?:\\{1,2}[^\\\s"'`<>|;,()]+)+/g,
  },
  {
    kind: "path", label: "File path",
    // Windows: C:\dir\file, \\server\share\dir, %APPDATA%\dir (doubled
    // backslashes in code strings too; spaces only inside folder names
    // made of plain words, as in Program Files (x86))
    re: /(?<![\w\\%])(?:[A-Za-z]:|\\\\[\w.$-]+|%[A-Za-z_]+%)(?:\\{1,2}(?:[^\\\s"'`<>|:*?;,()%.]+(?: [^\\\s"'`<>|:*?;,()%.]+)+(?: \(x86\))?(?=\\)|[^\\\s"'`<>|:*?;,()]+))+\\?/g,
  },
  {
    kind: "path", label: "File path",
    // Unix: /etc/shadow (two or more parts), ~/.ssh/id_rsa, ./run.sh, ../x
    re: /(?<![\w/.~:<>\])\\-])(?:(?:~|\.{1,2})(?:\/[\w.@+-]+)+|\/[\w.@+-]+(?:\/[\w.@+-]+)+)\/?/g,
    // not a JavaScript regular expression such as /abc/g
    check: (s) => !/^\/[^/]+\/[dgimsuyv]{1,6}$/.test(s),
  },
  {
    kind: "ipv4", label: "IPv4 address",
    re: new RegExp(`(?<![\\w.])${OCTET}(?:${DOT}${OCTET}){3}(?:\\/(?:3[0-2]|[12]?\\d))?(?![\\w.]*\\w)`, "g"),
  },
  {
    kind: "ipv6", label: "IPv6 address",
    re: new RegExp(`(?<![\\w:])(?:(?:${H16}:){7}${H16}|(?:${H16}:){1,7}:|(?:${H16}:){1,6}:${H16}|(?:${H16}:){1,5}(?::${H16}){1,2}|(?:${H16}:){1,4}(?::${H16}){1,3}|(?:${H16}:){1,3}(?::${H16}){1,4}|(?:${H16}:){1,2}(?::${H16}){1,5}|${H16}:(?::${H16}){1,6}|::(?:${H16}(?::${H16}){0,6})?)(?:\\/(?:12[0-8]|1[01]\\d|[1-9]?\\d))?(?![\\w:])`, "g"),
    // needs a letter or "::" so times like 12:30 never match
    check: (s) => s.includes("::") || /[a-fA-F]/.test(s) || s.split(":").length === 8,
  },
  {
    kind: "domain", label: "Defanged domain",
    re: /\b[a-zA-Z0-9-]+(?:\[\.\][a-zA-Z0-9-]+)+\b/g,
  },
  {
    kind: "wallet", label: "Bitcoin address",
    re: /\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g, check: (s) => base58CheckValid(s), // checksum must match
  },
  {
    kind: "wallet", label: "Bitcoin address",
    re: /\b(?:bc1|BC1)[02-9ac-hj-np-zAC-HJ-NP-Z]{11,71}\b/g, check: (s) => bech32Valid(s), // checksum must match
  },
  { kind: "wallet", label: "Ethereum address", re: /\b0x[0-9a-fA-F]{40}\b/g },
  { kind: "cve", label: "CVE ID", re: /\bCVE-\d{4}-\d{4,}\b/gi },
  { kind: "cwe", label: "CWE ID", re: /\bCWE-\d{1,4}\b/gi },
  { kind: "attack", label: "MITRE ATT&CK ID", re: /\b(?:T\d{4}(?:\.\d{3})?|TA\d{4})\b/g },
  {
    kind: "hash", label: "File hash",
    re: /(?<![0-9a-fA-F])(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{64}|[0-9a-fA-F]{40}|[0-9a-fA-F]{32})(?![0-9a-fA-F])/g,
    check: (s) => /[a-fA-F]/.test(s) && /\d/.test(s),
  },
];

// ---------------------------------------------------------------------
// Secrets: credentials that should not be in a note. Only formats with a
// distinctive prefix or shape, so ordinary text is not flagged.

const SECRETS: Array<{ label: string; re: RegExp; check?: (s: string) => boolean }> = [
  { label: "Private key", re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { label: "AWS access key ID", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { label: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { label: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { label: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { label: "Slack webhook", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g },
  { label: "Anthropic API key", re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/g },
  {
    label: "OpenAI API key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
    check: (s) => !s.startsWith("sk-ant-") && /\d/.test(s) && /[A-Za-z]/.test(s.slice(3)),
  },
  { label: "Hugging Face token", re: /\bhf_[A-Za-z]{34}\b/g },
  { label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { label: "Stripe secret key", re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{24,}\b/g },
  { label: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
];

export function findSecrets(text: string): PatternMatch[] {
  const out: PatternMatch[] = [];
  const taken: Array<[number, number]> = [];
  for (const p of SECRETS) {
    for (const m of text.matchAll(p.re)) {
      const s = m.index, e = s + m[0].length;
      if (p.check && !p.check(m[0])) continue;
      if (taken.some(([a, b]) => s < b && a < e)) continue;
      taken.push([s, e]);
      out.push({ start: s, end: e, kind: "secret", label: `Secret: ${p.label}. Remove it before sharing this note.`, ...(m[0].includes("\n") ? {} : { marker: "⚠ " }) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------
// Hidden characters: invisible characters, text-direction controls (as
// in "Trojan Source", CVE-2021-42574), hidden "tag" text (used to smuggle
// instructions to AI tools) and look-alike letters from other alphabets.

const INVISIBLE: Record<number, [string, string]> = {
  0x00ad: ["SHY", "soft hyphen"], 0x180e: ["MVS", "Mongolian vowel separator"],
  0x200b: ["ZWSP", "zero-width space"], 0x200c: ["ZWNJ", "zero-width non-joiner"],
  0x200d: ["ZWJ", "zero-width joiner"], 0x200e: ["LRM", "left-to-right mark"],
  0x200f: ["RLM", "right-to-left mark"], 0x061c: ["ALM", "Arabic letter mark"],
  0x202a: ["LRE", "left-to-right embedding"], 0x202b: ["RLE", "right-to-left embedding"],
  0x202c: ["PDF", "pop directional formatting"], 0x202d: ["LRO", "left-to-right override"],
  0x202e: ["RLO", "right-to-left override"], 0x2060: ["WJ", "word joiner"],
  0x2061: ["FA", "invisible function application"], 0x2062: ["IT", "invisible times"],
  0x2063: ["IS", "invisible separator"], 0x2064: ["IP", "invisible plus"],
  0x2066: ["LRI", "left-to-right isolate"], 0x2067: ["RLI", "right-to-left isolate"],
  0x2068: ["FSI", "first strong isolate"], 0x2069: ["PDI", "pop directional isolate"],
  0xfeff: ["BOM", "zero-width no-break space"],
};

export function findHidden(text: string): PatternMatch[] {
  const out: PatternMatch[] = [];
  // Unicode tag characters (U+E0000 to U+E007F) hide ASCII text: show it
  for (const m of text.matchAll(/[\u{E0000}-\u{E007F}]+/gu)) {
    const hidden = [...m[0]].map((c) => String.fromCodePoint(c.codePointAt(0)! - 0xe0000)).join("").replace(/[^\x20-\x7e]/g, "");
    const shown = hidden.length > 40 ? hidden.slice(0, 40) + "…" : hidden;
    out.push({ start: m.index, end: m.index + m[0].length, kind: "hidden",
      label: `Hidden text (Unicode tag characters): "${hidden}"`, marker: `⟨hidden: ${shown}⟩` });
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const known = INVISIBLE[code];
    if (!known || (code === 0xfeff && i === 0)) continue; // a byte-order mark at the very start is normal
    out.push({ start: i, end: i + 1, kind: "hidden",
      label: `Hidden character: ${known[1]} (U+${code.toString(16).toUpperCase().padStart(4, "0")})`, marker: `⟨${known[0]}⟩` });
  }
  // look-alike letters: Cyrillic or Greek letters inside a Latin word
  for (const m of text.matchAll(/[\p{L}\p{M}]+/gu)) {
    const w = m[0];
    if (!/\p{Script=Latin}/u.test(w) || !/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(w)) continue;
    for (const c of w.matchAll(/[\p{Script=Cyrillic}\p{Script=Greek}]/gu)) {
      const at = m.index + c.index;
      const script = /\p{Script=Cyrillic}/u.test(c[0]) ? "Cyrillic" : "Greek";
      out.push({ start: at, end: at + c[0].length, kind: "hidden",
        label: `Look-alike letter: ${script} "${c[0]}" (U+${c[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}) in a Latin word` });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const HASH_LABELS: Record<number, string> = { 32: "MD5 hash", 40: "SHA-1 hash", 64: "SHA-256 hash", 128: "SHA-512 hash" };

export function findSecurity(text: string): PatternMatch[] {
  const out: PatternMatch[] = [];
  const taken: Array<[number, number]> = [];
  const free = (s: number, e: number) => !taken.some(([a, b]) => s < b && a < e);
  for (const p of SECURITY) { // earlier kinds win overlaps (URLs before the IPs inside them)
    for (const m of text.matchAll(p.re)) {
      const s = m.index, e = s + m[0].length;
      if (p.check && !p.check(m[0])) continue;
      if (!free(s, e)) continue;
      taken.push([s, e]);
      const label = p.kind === "hash" ? HASH_LABELS[m[0].length] : p.label;
      const link = linkFor(p.kind, m[0]);
      out.push({ start: s, end: e, kind: p.kind, label, ...(link ? { link } : {}) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The public reference page for a CVE, CWE or ATT&CK ID. */
export function linkFor(kind: string, id: string): { url: string; site: string } | undefined {
  id = id.toUpperCase();
  if (kind === "cve") return { url: `https://nvd.nist.gov/vuln/detail/${id}`, site: "NVD" };
  if (kind === "cwe") return { url: `https://cwe.mitre.org/data/definitions/${id.slice(4)}.html`, site: "MITRE CWE" };
  if (kind === "attack") {
    const url = id.startsWith("TA")
      ? `https://attack.mitre.org/tactics/${id}/`
      : `https://attack.mitre.org/techniques/${id.replace(".", "/")}/`;
    return { url, site: "MITRE ATT&CK" };
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Wallet address checksums (so random strings are not flagged)

// SHA-256, small and synchronous (the browser's own is asynchronous).
// Constants: fractional parts of the square and cube roots of primes.
const K: number[] = [], H0: number[] = [];
for (let n = 2; K.length < 64; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
  if (!prime) continue;
  if (H0.length < 8) H0.push(((Math.sqrt(n) % 1) * 2 ** 32) >>> 0);
  K.push(((Math.cbrt(n) % 1) * 2 ** 32) >>> 0);
}

export function sha256(msg: Uint8Array): Uint8Array {
  const total = ((msg.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg); buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = msg.length * 8;
  dv.setUint32(total - 8, Math.floor(bits / 2 ** 32)); dv.setUint32(total - 4, bits >>> 0);
  const H = H0.slice(), W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = H as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  const out = new Uint8Array(32), odv = new DataView(out.buffer);
  H.forEach((v, i) => odv.setUint32(i * 4, v >>> 0));
  return out;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A legacy Bitcoin address (1... or 3...) with a valid Base58Check checksum. */
export function base58CheckValid(s: string): boolean {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) return false; n = n * 58n + BigInt(i); }
  const bytes: number[] = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 255n));
  for (const ch of s) { if (ch !== "1") break; bytes.unshift(0); }
  if (bytes.length !== 25 || (bytes[0] !== 0 && bytes[0] !== 5)) return false;
  const sum = sha256(sha256(Uint8Array.from(bytes.slice(0, 21))));
  return sum[0] === bytes[21] && sum[1] === bytes[22] && sum[2] === bytes[23] && sum[3] === bytes[24];
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** A bc1 Bitcoin address with a valid Bech32 (v0) or Bech32m (v1+) checksum. */
export function bech32Valid(s: string): boolean {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return false;
  s = s.toLowerCase();
  const data = [...s.slice(3)].map((c) => BECH32.indexOf(c));
  if (data.some((v) => v < 0) || data.length < 7) return false;
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [3, 3, 0, 2, 3, ...data]) { // "bc" expanded, then the data
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return (chk >>> 0) === (data[0] === 0 ? 1 : 0x2bc830a3);
}

/**
 * Alert badges for security indicators: solid, saturated backgrounds that
 * are the same in every theme and unlike any syntax colour, so an
 * indicator cannot be mistaken for ordinary code.
 */
export const ALERT_STYLE: Record<string, { fg: string; bg: string }> = {
  // secrets: act now. Yellow and black hazard stripes, unlike any other
  // badge (James chose this over a red that indicators also use)
  secret: { fg: "#ffffff", bg: "repeating-linear-gradient(135deg, #ffd600 0 6px, #111111 6px 12px)" },
  // hidden characters
  hidden: { fg: "#000000", bg: "#00e5ff" },
  // network and file indicators: red
  ipv4: { fg: "#ffffff", bg: "#ff1744" },
  ipv6: { fg: "#ffffff", bg: "#ff1744" },
  mac: { fg: "#ffffff", bg: "#ff1744" },
  hash: { fg: "#ffffff", bg: "#ff1744" },
  wallet: { fg: "#ffffff", bg: "#ff1744" },
  // web addresses: blue
  url: { fg: "#ffffff", bg: "#2962ff" },
  domain: { fg: "#ffffff", bg: "#2962ff" },
  registry: { fg: "#ffffff", bg: "#ff1744" },
  // email addresses and file paths: green
  email: { fg: "#000000", bg: "#00e676" },
  path: { fg: "#000000", bg: "#00e676" },
  // vulnerability IDs: amber
  cve: { fg: "#000000", bg: "#ffab00" },
  cwe: { fg: "#000000", bg: "#ffab00" },
  // MITRE ATT&CK: magenta
  attack: { fg: "#ffffff", bg: "#d500f9" },
};
