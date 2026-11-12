// Fetch findings: JavaScript sample for Treelights tests.
import { readFile } from "node:fs/promises";
export const API = "https://example.com/api";
const RETRIES = 3;

export async function fetchFindings(limit = 10, { verbose } = {}) {
  const res = await fetch(`${API}/findings?limit=${limit}`);
  if (!res.ok) throw new Error("request failed");
  const items = (await res.json()).items ?? [];
  return items.filter((f) => f.severity >= 7).map((f) => ({ id: f.id, sev: f.severity }));
}

class Report extends Array {
  #count = 0;
  constructor(title) { super(); this.title = title; }
  static from(list) { return new Report(list.join(", ")); }
  get size() { return this.#count; }
}

for (let i = 0; i < RETRIES; i++) {
  switch (i) { case 0: break; default: console.log(i, typeof i, null, undefined, /ab+c/gi); }
}
const el = <div className="card">{items.length} findings</div>;
