// Applies a Treelights grammar patch (grammars/patches/<lang>.json) to a
// grammar's src/grammar.json. The parser is then regenerated from that
// JSON with `tree-sitter generate src/grammar.json`, so none of the
// upstream grammar's JavaScript runs. Supported changes:
//   addChoiceMembers: { rule: ["literal", ...] }  more strings in a CHOICE rule
//   addAlternatives:  { rule: [ruleJson, ...] }     more alternatives in a CHOICE rule
// Usage: node grammars/patch-grammar.mjs <grammar.json> <patch.json>
import fs from "node:fs";

const [file, patchFile] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(file, "utf8"));
const patch = JSON.parse(fs.readFileSync(patchFile, "utf8"));
const choice = (name) => {
  const r = g.rules[name];
  if (!r || r.type !== "CHOICE") { console.error(`patch-grammar: rule ${name} is not a CHOICE`); process.exit(1); }
  return r;
};
for (const [name, words] of Object.entries(patch.addChoiceMembers ?? {})) {
  const r = choice(name);
  for (const w of words) if (!r.members.some((m) => m.type === "STRING" && m.value === w)) r.members.push({ type: "STRING", value: w });
}
for (const [name, alts] of Object.entries(patch.addAlternatives ?? {})) {
  const r = choice(name);
  for (const a of alts) if (!r.members.some((m) => JSON.stringify(m) === JSON.stringify(a))) r.members.push(a);
}
fs.writeFileSync(file, JSON.stringify(g, null, 2) + "\n");
console.log(`patch-grammar: applied ${patchFile} to ${file}`);
