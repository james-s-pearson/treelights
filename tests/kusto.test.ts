// The KQL grammar is patched at build time (grammars/patches/kusto.json)
// to add common operators the 2023 grammar lacks. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Language, Parser } from "web-tree-sitter";

const root = path.resolve(import.meta.dirname, "..");

test("KQL: operators added by the patch parse without errors", async () => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(root, "build/wasm/kusto.wasm")));
  const queries = [
    "SigninLogs | where ResultType != 0 | take 10",
    "SecurityEvent | limit 100",
    "SigninLogs | summarize Count = count() by UserPrincipalName | top 10 by Count desc",
    "SecurityEvent | count",
    "Heartbeat | summarize count() by bin(TimeGenerated, 1h) | render timechart",
    "T | project-rename NewName = OldName | project-keep NewName",
    "T | sample 50",
    "T | getschema",
    fs.readFileSync(path.join(root, "tests/samples/sample.kql"), "utf8"),
  ];
  for (const q of queries) {
    const tree = parser.parse(q)!;
    assert.equal(tree.rootNode.hasError, false, `does not parse: ${q.slice(0, 60)}`);
    tree.delete();
  }
});
