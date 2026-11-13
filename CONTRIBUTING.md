# Contributing to Treelights

Thank you for your interest. Bug reports, theme fixes and small, focused
pull requests are welcome.

Treelights was designed and directed by James Pearson; its code was
generated with AI assistance (Claude) and tested by James. Contributions
made with AI tools are welcome too; please say so in the pull request.

## Reporting a problem

- **Security issues:** do not open a public issue. See
  [SECURITY.md](SECURITY.md#reporting-a-vulnerability).
- **Everything else:** open an issue with your Obsidian version, your
  operating system, the language of the code block and, if you can, a
  short example that shows the problem. Leave out anything private.

## Building

You need Node.js 24 or later (tested with Node.js 26), because the tests
are TypeScript files that Node runs directly.

```sh
npm install            # also checks the build tools' fingerprints
npm run build:grammars # compiles every grammar from its pinned source
npm run build          # main.js and styles.css
npm test               # every test, including the supply-chain checks
npm run typecheck      # TypeScript type check (the tests do not check types)
npm run test:yara      # the YARA grammar's own tests
```

Compiling the grammars needs the `tree-sitter` program (installed by
`npm install`) and the WASI SDK; both are checked against recorded
fingerprints, as described in SECURITY.md. The compiled grammars go in
`build/`, which is not committed.

To try a build, copy `main.js`, `manifest.json` and `styles.css` into
`.obsidian/plugins/treelights/` in a test vault, not your everyday one.

## Generated files

The build writes `src/generated/` (the grammar list, capture names and
bundled Helix themes) and `styles.css`. Both are committed so that the
code people read is the code that runs. If a change alters them, commit
the regenerated files with it. Do not edit them by hand.

## Pull requests

- Keep each pull request to one change, and explain why it is needed.
- Run `npm test`; every test must pass.
- Do not add network requests, file access outside the vault API, or
  code that runs text as code. A test checks the built `main.js` for
  these.
- New or updated grammars and dependencies follow the update rule in
  [SECURITY.md](SECURITY.md#updating-a-dependency): pinned to a full
  commit hash, reviewed, rebuilt and fingerprinted on purpose.

## Licence

By contributing, you agree that your contribution is licensed under the
MIT licence in [LICENSE](LICENSE).
