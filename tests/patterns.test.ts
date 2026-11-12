// Tests for colour previews and security indicators. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { base58CheckValid, bech32Valid, findColours, findSecurity, hslToHex, sha256, textOn } from "../src/patterns.ts";

const kinds = (text: string) => findSecurity(text).map((m) => [m.kind, text.slice(m.start, m.end)]);
const colours = (text: string) => findColours(text).map((m) => [text.slice(m.start, m.end), m.colour]);

test("colour previews: hex, rgb() and hsl()", () => {
  assert.deepEqual(colours("color: #FF6B1A;"), [["#FF6B1A", "#ff6b1a"]]);
  assert.deepEqual(colours("a #fff b #ff6b1acc"), [["#fff", "#ffffff"], ["#ff6b1acc", "#ff6b1a"]]);
  assert.deepEqual(colours("rgb(34, 36, 54)"), [["rgb(34, 36, 54)", "#222436"]]);
  assert.deepEqual(colours("rgb(34 36 54 / 90%)"), [["rgb(34 36 54 / 90%)", "#222436"]]);
  assert.deepEqual(colours("hsl(0, 100%, 50%)"), [["hsl(0, 100%, 50%)", "#ff0000"]]);
  assert.equal(hslToHex(120, 1, 0.25), "#008000");
});

test("colour previews: not issue numbers, entities or anchors", () => {
  assert.deepEqual(colours("fixes #12345 and &#123; and page#abc"), []);
});

test("text on a colour picks the readable one", () => {
  assert.equal(textOn("#ffffff"), "#000000");
  assert.equal(textOn("#222436"), "#ffffff");
  assert.equal(textOn("#ff6b1a"), "#000000");
});

test("IPv4, CIDR and defanged addresses", () => {
  assert.deepEqual(kinds("nmap 10.0.0.1 and 192.168.1.0/24"), [["ipv4", "10.0.0.1"], ["ipv4", "192.168.1.0/24"]]);
  assert.deepEqual(kinds("ioc 203[.]0[.]113[.]42 seen"), [["ipv4", "203[.]0[.]113[.]42"]]);
  assert.deepEqual(kinds("host 10.0.0.1:443."), [["ipv4", "10.0.0.1"]]);
  assert.deepEqual(kinds("version 1.2.3 or 256.1.1.1 or 1.2.3.4.5"), []);
});

test("IPv6, but not times", () => {
  assert.deepEqual(kinds("addr ::1 and fe80::1ff:fe23:4567:890a"), [["ipv6", "::1"], ["ipv6", "fe80::1ff:fe23:4567:890a"]]);
  assert.deepEqual(kinds("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), [["ipv6", "2001:0db8:85a3:0000:0000:8a2e:0370:7334"]]);
  assert.deepEqual(kinds("at 12:30:45 today"), []);
});

test("URLs (also defanged) win over the addresses inside them", () => {
  assert.deepEqual(kinds('curl "https://10.0.0.1/admin?x=1"'), [["url", "https://10.0.0.1/admin?x=1"]]);
  assert.deepEqual(kinds("hxxps[:]//evil[.]com/payload"), [["url", "hxxps[:]//evil[.]com/payload"]]);
  assert.deepEqual(kinds("beacon to evil[.]example[.]com"), [["domain", "evil[.]example[.]com"]]);
  assert.deepEqual(kinds("open scan.py and obj.method()"), []);
});

test("CVE, CWE and ATT&CK IDs", () => {
  assert.deepEqual(kinds("CVE-2024-3094 is CWE-506; T1059.001 and TA0001"),
    [["cve", "CVE-2024-3094"], ["cwe", "CWE-506"], ["attack", "T1059.001"], ["attack", "TA0001"]]);
  assert.deepEqual(kinds("T12 or T12345 or cve-24-1"), []);
});

test("file hashes by length, not plain numbers or words", () => {
  const md5 = "d41d8cd98f00b204e9800998ecf8427e";
  const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const m = findSecurity(`md5 ${md5} sha ${sha256}`);
  assert.deepEqual(m.map((x) => x.label), ["MD5 hash", "SHA-256 hash"]);
  assert.deepEqual(kinds("12345678901234567890123456789012"), []); // digits only
  assert.deepEqual(kinds("deadbeefdeadbeefdeadbeefdeadbeef"), []); // letters only
  assert.deepEqual(kinds(`${md5}0`), []); // 33 hex digits is no known hash
});

test("email addresses (also defanged), not image names or decorators", () => {
  assert.deepEqual(kinds("from phish@evil.example.com and analyst[@]example[.]com"),
    [["email", "phish@evil.example.com"], ["email", "analyst[@]example[.]com"]]);
  assert.deepEqual(kinds('src="logo@2x.png" and @property and npm i @types/node'), []);
});

test("MAC addresses in three forms, not numbers or times", () => {
  assert.deepEqual(kinds("00:1A:2B:3C:4D:5E 00-1a-2b-3c-4d-5e 001a.2b3c.4d5e"),
    [["mac", "00:1A:2B:3C:4D:5E"], ["mac", "00-1a-2b-3c-4d-5e"], ["mac", "001a.2b3c.4d5e"]]);
  assert.deepEqual(kinds("00:1a-2b:3c-4d:5e or 2024.1015.1200 or 12:30:45"), []);
});

test("Windows registry keys", () => {
  assert.deepEqual(kinds("reg add HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v x"),
    [["registry", "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"]]);
  assert.deepEqual(kinds('Get-Item "HKCU:\\Environment"'), [["registry", "HKCU:\\Environment"]]);
  assert.deepEqual(kinds("HKLM alone, or a path C:\\Windows"), [["path", "C:\\Windows"]]); // a path, not a key
});

test("SHA-256 matches Node's", () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 200]) {
    const data = randomBytes(len);
    assert.equal(Buffer.from(sha256(data)).toString("hex"), createHash("sha256").update(data).digest("hex"));
  }
});

test("wallet addresses only with valid checksums", () => {
  assert.ok(base58CheckValid("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"));
  assert.ok(base58CheckValid("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"));
  assert.ok(!base58CheckValid("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb")); // one character changed
  assert.ok(bech32Valid("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4")); // BIP 173
  assert.ok(bech32Valid("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0")); // BIP 350
  assert.ok(!bech32Valid("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"));
  assert.deepEqual(kinds("pay 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa or 0x52908400098527886E0F7030069857D2E4169EE7"),
    [["wallet", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"], ["wallet", "0x52908400098527886E0F7030069857D2E4169EE7"]]);
  assert.deepEqual(kinds("id 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb"), []);
});

test("CVE, CWE and ATT&CK IDs link to their reference pages", () => {
  const links = findSecurity("cve-2024-3094 CWE-506 T1059.001 TA0001").map((m) => m.link?.url);
  assert.deepEqual(links, [
    "https://nvd.nist.gov/vuln/detail/CVE-2024-3094",
    "https://cwe.mitre.org/data/definitions/506.html",
    "https://attack.mitre.org/techniques/T1059/001/",
    "https://attack.mitre.org/tactics/TA0001/",
  ]);
  assert.equal(findSecurity("10.0.0.1")[0].link, undefined); // addresses never link
});

test("file paths: Windows and Unix", () => {
  assert.deepEqual(kinds("run C:\\Windows\\System32\\cmd.exe now"), [["path", "C:\\Windows\\System32\\cmd.exe"]]);
  assert.deepEqual(kinds('"C:\\\\Users\\\\Public\\\\x.ps1"'), [["path", "C:\\\\Users\\\\Public\\\\x.ps1"]]);
  assert.deepEqual(kinds("C:\\Program Files\\Tool\\tool.exe -v"), [["path", "C:\\Program Files\\Tool\\tool.exe"]]);
  assert.deepEqual(kinds("C:\\Program Files (x86)\\App\\a.dll x"), [["path", "C:\\Program Files (x86)\\App\\a.dll"]]);
  assert.deepEqual(kinds("copy \\\\fileserver\\share\\a.txt and %APPDATA%\\Microsoft\\x.dll"),
    [["path", "\\\\fileserver\\share\\a.txt"], ["path", "%APPDATA%\\Microsoft\\x.dll"]]);
  assert.deepEqual(kinds("cat /etc/shadow ~/.ssh/id_rsa ./run.sh ../loot/creds.txt"),
    [["path", "/etc/shadow"], ["path", "~/.ssh/id_rsa"], ["path", "./run.sh"], ["path", "../loot/creds.txt"]]);
});

test("file paths: not division, comments, regexes, tags or fractions", () => {
  assert.deepEqual(kinds("x = a / b; y = a/b/c; // note /tmp alone; s.replace(/abc/g, '') </div> 1/2 10/15/2026 #include <sys/types.h>"), []);
  assert.deepEqual(kinds("https://example.com/a/b"), [["url", "https://example.com/a/b"]]); // the URL wins
});

// ---------------------------------------------------------------------
// Secrets and hidden characters (fake keys in real formats). Fake keys are
// assembled from pieces at run time so the source file contains nothing
// that secret scanners (for example GitHub push protection) would flag.
import { findHidden, findSecrets } from "../src/patterns.ts";

const AWS_EXAMPLE = "AKIA" + "IOSFODNN7EXAMPLE"; // AWS's documented example key ID
const PEM = (kind: string) => `-----BEGIN ${kind} ` + "PRIVATE KEY-----";
const PEM_END = (kind: string) => `-----END ${kind} ` + "PRIVATE KEY-----";
const secrets = (text: string) => findSecrets(text).map((m) => [m.label.replace(/^Secret: |\. Remove.*$/g, ""), text.slice(m.start, m.end)]);

test("secrets in common formats are found", () => {
  const gh = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
  const openai = "sk-proj-" + "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0f";
  const anthropic = "sk-ant-api03-" + "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM";
  const text = `aws ${AWS_EXAMPLE} gh ${gh} ai ${openai} claude ${anthropic} jwt ${jwt} google ${"AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"} stripe sk_live_${"4eC39HqLyjWDarjtT1zdp7dc"}`;
  assert.deepEqual(secrets(text).map(([l]) => l),
    ["AWS access key ID", "GitHub token", "OpenAI API key", "Anthropic API key", "JSON Web Token", "Google API key", "Stripe secret key"]);
  const pem = `${PEM("OPENSSH")}\nb3BlbnNzaC1rZXktdjEAAAAA\n${PEM_END("OPENSSH")}`;
  assert.deepEqual(secrets(`key:\n${pem}\n`), [["Private key", pem]]);
  assert.equal(findSecrets(pem)[0].marker, undefined); // no marker on multi-line blocks
  assert.equal(findSecrets(AWS_EXAMPLE)[0].marker, "⚠ ");
});

test("secrets: ordinary text is not flagged", () => {
  assert.deepEqual(secrets("pip install scikit-learn sk-learn; ghp_short; AKIA is a prefix; sk-this-is-just-a-long-flag-name-here"), []);
  assert.deepEqual(secrets("-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----"), []); // public keys are fine
});

test("hidden characters: invisible, direction controls and tag text", () => {
  const z = findHidden("pay​pal");
  assert.deepEqual(z.map((m) => [m.start, m.marker]), [[3, "⟨ZWSP⟩"]]);
  assert.deepEqual(findHidden("if (x) { /* ‮ } ⁦ */").map((m) => m.marker), ["⟨RLO⟩", "⟨LRI⟩"]);
  const tags = [..."ignore previous"].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
  const t = findHidden(`hello${tags} world`);
  assert.equal(t.length, 1);
  assert.match(t[0].label, /"ignore previous"/);
  assert.equal(t[0].marker, "⟨hidden: ignore previous⟩");
  assert.deepEqual(findHidden("﻿start of file"), []); // byte-order mark at the start is normal
});

test("hidden characters: look-alike letters only inside Latin words", () => {
  const m = findHidden("login at pаypal.com");
  assert.equal(m.length, 1);
  assert.match(m[0].label, /Cyrillic "а" \(U\+0430\)/);
  assert.deepEqual(findHidden("Привет мир, naïve café, αβγ"), []); // whole words in one alphabet are fine
});
