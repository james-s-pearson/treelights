// Treelights' size budget (main.js, which holds every grammar). Run after
// npm run build. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const BUDGET = 4_500_000; // bytes

test("main.js stays within the size budget", (t) => {
  const file = path.join(import.meta.dirname, "..", "main.js");
  if (!fs.existsSync(file)) return t.skip("main.js not built yet");
  const size = fs.statSync(file).size;
  assert.ok(size <= BUDGET, `main.js is ${size} bytes, over the ${BUDGET}-byte budget`);
});
