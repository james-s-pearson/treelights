// Runs after npm install: checks the tree-sitter program (downloaded by
// tree-sitter-cli's install script without a checksum) and the WASI SDK
// against their recorded fingerprints. See SECURITY.md.
import { checkTools, stopOn } from "./supply-chain.mjs";
stopOn(checkTools(), "build tools");
console.log("Build tools match their recorded fingerprints.");
