// Treelights: Tree-sitter highlighting for Obsidian code blocks.

import * as obsidian from "obsidian";
import { Notice, Platform, Plugin, PluginSettingTab, setTooltip, type App, type MarkdownPostProcessorContext, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Language, Parser, Query } from "web-tree-sitter";
import { highlight, LANGUAGE_ALIASES, normaliseLanguage, paint, prepareQuery, type LanguageEntry, type Span } from "./engine.ts";
import { resolveStyle, type Style, type Theme } from "./theme.ts";
import { grammars, queryPacks, runtimeWasm } from "./generated/registry.ts";
import { captureNames } from "./generated/captures.ts";
import { ALERT_STYLE, findColours, findHidden, findSecrets, findSecurity, textOn, type PatternMatch } from "./patterns.ts";
import { helixToTheme, parseToml, ThemeImportError, type HelixSource } from "./helix.ts";
import { bundledHelix } from "./generated/helix-themes.ts";
import tokyonightMoon from "../themes/tokyonight-moon.json";
import neonAlleyDark from "../themes/neon-alley-dark.json";
import neonAlleyLight from "../themes/neon-alley-light.json";
import followObsidian from "../themes/obsidian.json";
import tokyonightDay from "../themes/tokyonight-day.json";

interface Settings {
  darkTheme: string;
  lightTheme: string;
  packs: string[]; // enabled query packs, for example "lazyvim"
  useThemeBackground: boolean;
  customThemes: Theme[]; // built from helixSources; kept for quick start-up
  helixSources: HelixSource[]; // imported Helix themes, as plain data
  colourPreviews: boolean; // show #rrggbb, rgb(), hsl() on their colour
  securityFeatures: boolean; // master switch for the three security features below
  securityIndicators: boolean; // highlight IPs, URLs, CVE/ATT&CK IDs, hashes
  secretWarnings: boolean; // flag API keys, tokens and private keys
  hiddenCharacters: boolean; // show invisible, direction and look-alike characters
}

const NEOVIM_THEMES: Theme[] = [tokyonightMoon as Theme, tokyonightDay as Theme];
/** Helix themes shipped with Treelights (MPL-2.0, see themes/helix). */
const bundledLibrary = (n: string) => bundledHelix.find((h) => h.name === n);
/** Treelights' own themes (tools/make-themes.mjs). */
const OWN_THEMES: Theme[] = [followObsidian as Theme, neonAlleyDark as Theme, neonAlleyLight as Theme];
const BUILT_IN_THEMES: Theme[] = [
  ...NEOVIM_THEMES,
  ...OWN_THEMES,
  ...bundledHelix.map((h) => helixToTheme(h, captureNames, bundledLibrary).theme),
];

const DEFAULTS: Settings = {
  // fits whatever Obsidian theme is active, out of the box
  darkTheme: "Follow Obsidian theme",
  lightTheme: "Follow Obsidian theme",
  packs: [],
  useThemeBackground: true,
  customThemes: [],
  helixSources: [],
  colourPreviews: false,
  securityFeatures: false,
  // on when the master switch is turned on; each can then be turned off
  securityIndicators: true,
  secretWarnings: true,
  hiddenCharacters: true,
};

/** Tells Treelights' editor extension to redraw (a grammar loaded, or the theme changed). */
const refreshEffect = StateEffect.define<null>();

/** Unpack a grammar stored with zlib "deflate", using the built-in decompressor. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One painted run of text with a style class (and a hover label for patterns). */
interface Run { from: number; to: number; cls: string; title?: string; chip?: boolean }

export default class TreelightsPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private parser?: Parser;
  private ready?: Promise<void>;
  private languages = new Map<string, LanguageEntry | undefined>();
  private styleClasses = new Map<string, string>(); // style key -> class
  private styleProps = new Set<string>(); // CSS variables currently set on the page
  private cache = new Map<string, Run[]>(); // lang + code -> runs
  private editorExtension: Extension[] = [];
  private pending = new Set<string>(); // languages being loaded
  private disabledReason?: string; // set by the safety brake

  async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    this.settings = { ...DEFAULTS, ...saved };
    // settings saved before the master switch existed: keep features that
    // were on working
    if (saved && saved.securityFeatures === undefined) {
      this.settings.securityFeatures = !!(saved.securityIndicators || saved.secretWarnings || saved.hiddenCharacters);
    }
    this.ready = this.init();
    this.addSettingTab(new TreelightsSettingTab(this.app, this));

    this.registerMarkdownPostProcessor(async (el, ctx) => {
      // pattern features in inline code (for example an IP address or
      // colour mentioned in a sentence)
      if (this.patternsOn) {
        for (const code of Array.from(el.querySelectorAll<HTMLElement>(":not(pre) > code"))) this.renderInline(code);
      }
      const blocks = el.querySelectorAll<HTMLElement>("pre > code");
      if (!blocks.length) return;
      await this.ready;
      // Let other plugins (for example Codeblock Customizer) finish
      // building the block first; Treelights then colours it in place.
      await new Promise((r) => window.setTimeout(r, 0));
      await new Promise((r) => window.requestAnimationFrame(r));
      for (const code of Array.from(blocks)) await this.renderReading(code, el, ctx);
    });

    // Tooltips for pattern badges, in every window (Reading view and
    // Live Preview both re-create their elements, so show them on hover)
    // and Cmd/Ctrl-click opens a badge's reference page (capture phase, so
    // the editor does not also add a cursor)
    this.registerDomEvent(document, "mouseover", showBadgeTooltip);
    this.registerDomEvent(document, "mousedown", openBadgeLink, { capture: true });
    this.registerEvent(this.app.workspace.on("window-open", (win) => {
      this.writeStyles(); // style variables for the new window
      this.registerDomEvent(win.doc, "mouseover", showBadgeTooltip);
      this.registerDomEvent(win.doc, "mousedown", openBadgeLink, { capture: true });
    }));

    this.editorExtension.push(this.livePreviewPlugin(this));
    this.registerEditorExtension(this.editorExtension);
    this.registerEvent(this.app.workspace.on("css-change", () => this.refresh()));
  }

  onunload() {
    this.clearStyleProps();
    this.parser?.delete();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refresh();
  }

  // ---------------------------------------------------------------
  // Engine

  private async init() {
    // Use the embedded runtime; never build a URL or fetch anything.
    await Parser.init({ wasmBinary: await inflate(runtimeWasm), locateFile: (file: string) => file });
    this.parser = new Parser();
    this.buildStyles();
  }

  /** Load a language and everything it may inject, before highlighting. */
  private async prepareLanguages(name: string, seen = new Set<string>()) {
    if (seen.has(name)) return;
    seen.add(name);
    if (!this.languages.get(name)) {
      const asset = grammars[name];
      if (!asset) { this.languages.set(name, undefined); return; }
      const language = await Language.load(await inflate(asset.wasm));
      this.languages.set(name, this.buildEntry(name, language));
      // Results cached before this grammar arrived (for example Lua drawn
      // before the Vim grammar inside it had loaded) are now incomplete.
      this.cache.clear();
    }
    // injected languages named in this language's injection queries
    const inj = grammars[name]?.injections ?? "";
    for (const m of inj.matchAll(/injection\.language\s+"([\w-]+)"/g)) {
      await this.prepareLanguages(normaliseLanguage(m[1]), seen);
    }
    for (const other of ["luap", "printf", "regex", "vim", "luadoc", "comment"]) {
      if (grammars[other] && inj.includes(other)) await this.prepareLanguages(other, seen);
    }
  }

  /** Compile a language's queries, including enabled query packs. */
  private buildEntry(name: string, language: Language): LanguageEntry {
    const asset = grammars[name];
    const extra = (kind: string) => queryPacks
      .filter((p) => p.lang === name && p.kind === kind && this.settings.packs.includes(p.pack))
      .map((p) => p.text).join("\n");
    const mk = (base: string | undefined, kind: string) => {
      const text = [base ?? "", extra(kind)].join("\n").trim();
      return text ? new Query(language, prepareQuery(text)) : undefined;
    };
    return { language, highlights: mk(asset?.highlights, "highlights"), injections: mk(asset?.injections, "injections") };
  }

  /** Rebuild the queries of every loaded language (after a pack is switched). */
  rebuildQueries() {
    for (const [name, entry] of this.languages) {
      if (!entry) continue;
      entry.highlights?.delete();
      entry.injections?.delete();
      this.languages.set(name, this.buildEntry(name, entry.language));
    }
    this.cache.clear();
  }

  private get theme(): Theme {
    const dark = document.body.classList.contains("theme-dark");
    const wanted = dark ? this.settings.darkTheme : this.settings.lightTheme;
    const all = [...this.settings.customThemes, ...BUILT_IN_THEMES];
    return all.find((t) => t.name === wanted) ?? (followObsidian as Theme);
  }

  /** Highlight code into runs of style classes. */
  /** Whether any pattern feature (previews, indicators, secrets, hidden) is on. */
  get patternsOn(): boolean {
    const s = this.settings;
    return s.colourPreviews || (s.securityFeatures && (s.securityIndicators || s.secretWarnings || s.hiddenCharacters));
  }

  /** Pattern features only, for code blocks without a Treelights grammar
   * (plain text, logs, unlabelled blocks, other languages). */
  patternRuns(code: string): Run[] {
    const key = `\u0001plain\u0000${code}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const runs = this.overlayPatterns(code, [], this.theme);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, runs);
    return runs;
  }

  private runs(code: string, lang: string): Run[] | undefined {
    if (!this.parser || !this.languages.get(lang)) return undefined;
    const key = `${lang}\u0000${code}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const theme = this.theme;
    const spans: Span[] = highlight(code, lang, (n) => this.languages.get(n), this.parser);
    const styleOf = (s: Span) => resolveStyle(theme, s.capture, s.lang);
    const winner = paint(code, spans, (s) => !!styleOf(s)?.fg);
    const runs: Run[] = [];
    for (let i = 0; i < code.length;) {
      const w = winner[i];
      let j = i + 1;
      while (j < code.length && winner[j] === w) j++;
      if (w >= 0) {
        const cls = this.classFor(styleOf(spans[w])!);
        if (cls) runs.push({ from: i, to: j, cls });
      }
      i = j;
    }
    const final = this.overlayPatterns(code, runs, theme);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, final);
    return final;
  }

  /** Draw colour previews and security indicators over Tree-sitter's runs. */
  private overlayPatterns(code: string, runs: Run[], theme: Theme): Run[] {
    const matches: PatternMatch[] = [
      ...(this.settings.colourPreviews ? findColours(code) : []),
      ...(this.settings.securityFeatures && this.settings.securityIndicators ? findSecurity(code) : []),
      // later entries win where matches overlap: a token inside a URL is a secret
      ...(this.settings.securityFeatures && this.settings.secretWarnings ? findSecrets(code) : []),
      ...(this.settings.securityFeatures && this.settings.hiddenCharacters ? findHidden(code) : []),
    ];
    if (!matches.length) return runs;
    const cls: (string | undefined)[] = new Array(code.length);
    const title: (string | undefined)[] = new Array(code.length);
    const chipClasses = new Set<string>();
    for (const r of runs) for (let k = r.from; k < r.to; k++) cls[k] = r.cls;
    for (const m of matches) {
      let style: Style | undefined;
      if (m.colour) style = { fg: textOn(m.colour), bg: m.colour, preview: true };
      else style = { ...ALERT_STYLE[m.kind], bold: true, preview: true, ...(m.marker ? { marker: m.marker } : {}),
        // hidden characters are isolated, so a direction override cannot
        // reorder the rest of the line ("Trojan Source"): code shows in its
        // true order, with the marker saying the character is there
        ...(m.kind === "hidden" ? { isolate: true } : {}) };
      const c = this.classFor(style);
      if (c) chipClasses.add(c);
      const tip = m.link ? `${m.label}${SEP}${m.link.url}${SEP}${m.link.site}` : m.label;
      for (let k = m.start; k < m.end; k++) { cls[k] = c; title[k] = tip; }
    }
    const out: Run[] = [];
    for (let i = 0; i < code.length;) {
      let j = i + 1;
      while (j < code.length && cls[j] === cls[i] && title[j] === title[i]) j++;
      if (cls[i]) out.push({ from: i, to: j, cls: cls[i]!, ...(title[i] ? { title: title[i] } : {}), ...(chipClasses.has(cls[i]!) ? { chip: true } : {}) });
      i = j;
    }
    return out;
  }

  // ---------------------------------------------------------------
  // Styles: one CSS class per distinct style in the active themes

  private classFor(style: Style): string {
    const key = JSON.stringify(style);
    let cls = this.styleClasses.get(key);
    if (!cls) {
      // style slots are fixed in styles.css (tools/gen-styles.mjs); beyond
      // them a style is left uncoloured rather than breaking anything
      if (this.styleClasses.size >= STYLE_SLOTS) return "";
      cls = `tl-${this.styleClasses.size}`;
      // badges and colour chips also carry "tl-chip" (see styles.css)
      if (style.preview) cls += " tl-chip";
      this.styleClasses.set(key, cls);
      this.writeStyles();
    }
    return cls;
  }

  private buildStyles() {
    this.styleClasses.clear();
    this.cache.clear();
    this.writeStyles();
  }

  /**
   * Apply every style in use as CSS variables on the page; the rules that
   * use them are in styles.css. (Plugins may not create <style> elements.)
   */
  private writeStyles() {
    const theme = this.theme;
    const props: Record<string, string> = {};
    if (this.settings.useThemeBackground && theme.background) {
      props["--code-background"] = theme.background;
      props["--code-normal"] = theme.foreground ?? "inherit";
    }
    for (const [key, cls] of this.styleClasses) {
      const s = JSON.parse(key) as Style;
      const n = cls.split(" ")[0].slice(3); // "tl-12 tl-chip" -> "12"
      const set = (name: string, value: string | false | undefined) => { if (value) props[`--tl-${n}-${name}`] = value; };
      set("c", s.fg ?? "inherit");
      set("w", s.bold && "bold");
      set("s", s.italic && "italic");
      set("d", s.strikethrough ? "line-through" : (s.underline || s.undercurl) && "underline");
      // a pattern (hazard stripes) and a plain colour both work as "background";
      // dark edges keep white text readable on stripes
      set("bg", s.bg);
      set("ts", s.bg?.includes("gradient(") && "0 0 2px #000, 0 0 2px #000");
      if (s.preview) {
        // chips: rounded, with an outline in the text colour so a colour
        // equal to the code background still shows
        set("r", "3px");
        set("p", "0 2px");
        set("sh", `inset 0 0 0 1px color-mix(in srgb, ${s.fg ?? "currentColor"} 45%, transparent)`);
      }
      // hidden characters are isolated so a direction override cannot
      // reorder the line ("Trojan Source")
      set("ub", s.isolate && "isolate");
      set("dir", s.isolate && "ltr");
      // a marker (warning sign, or the name of an invisible character) is
      // drawn before the text; the note is not changed
      set("m", s.marker && `"${s.marker.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    }
    this.applyStyleProps(props);
  }

  /** Set the style variables on every open window's page, clearing old ones. */
  private applyStyleProps(props: Record<string, string>) {
    const cleared: Record<string, string> = {};
    for (const name of this.styleProps) if (!(name in props)) cleared[name] = "";
    this.styleProps = new Set(Object.keys(props));
    for (const doc of this.documents()) {
      doc.body.setCssProps({ ...cleared, ...props });
      doc.body.classList.add("treelights-on");
    }
  }

  private clearStyleProps() {
    const cleared: Record<string, string> = {};
    for (const name of this.styleProps) cleared[name] = "";
    for (const doc of this.documents()) {
      doc.body.setCssProps(cleared);
      doc.body.classList.remove("treelights-on");
    }
    this.styleProps.clear();
  }

  /** The main window and any pop-out windows. */
  private documents(): Document[] {
    const docs = new Set<Document>([document]);
    this.app.workspace.iterateAllLeaves((leaf) => { const d = leaf.view?.containerEl?.ownerDocument; if (d) docs.add(d); });
    return [...docs];
  }

  private refresh() {
    this.buildStyles();
    this.redrawEditors();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as unknown as { previewMode?: { rerender?: (full: boolean) => void } };
      view.previewMode?.rerender?.(true);
    });
  }

  /** Ask every open editor to redraw Treelights' decorations. */
  private redrawEditors() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const cm = (leaf.view as unknown as { editor?: { cm?: EditorView } }).editor?.cm;
      cm?.dispatch({ effects: refreshEffect.of(null) });
    });
  }

  /** Load a language once, then redraw editors that were waiting for it. */
  private requestLanguage(lang: string) {
    if (this.pending.has(lang) || this.languages.get(lang)) return;
    this.pending.add(lang);
    void (async () => {
      try {
        await this.ready;
        await this.prepareLanguages(lang);
        this.redrawEditors();
      } catch (e) {
        console.error(`Treelights: could not load ${lang}`, e);
      } finally {
        this.pending.delete(lang);
      }
    })();
  }

  // ---------------------------------------------------------------
  // Helix themes

  /** Rebuild every imported theme (so a theme picks up a parent imported later). */
  private rebuildHelixThemes() {
    const byName = (n: string) => this.settings.helixSources.find((h) => h.name === n) ?? bundledLibrary(n);
    this.settings.customThemes = this.settings.helixSources.map((h) => helixToTheme(h, captureNames, byName).theme);
  }

  /** Import a Helix theme file chosen by the user. */
  async importHelixTheme(fileName: string, text: string) {
    try {
      await this.ready;
      await this.prepareLanguages("toml");
      const toml = this.languages.get("toml");
      if (!toml) throw new ThemeImportError("The TOML grammar is not available.");
      const name = fileName.replace(/\.toml$/i, "").replace(/[^\w.-]/g, "_").slice(0, 60);
      const data = parseToml(text, toml.language);
      const source: HelixSource = { name, data };
      const byName = (n: string) => (n === name ? source : this.settings.helixSources.find((h) => h.name === n) ?? bundledLibrary(n));
      const result = helixToTheme(source, captureNames, byName);
      if (result.mappedCaptures === 0) throw new ThemeImportError("No syntax colours found. Is this a Helix theme?");
      this.settings.helixSources = [...this.settings.helixSources.filter((h) => h.name !== name), source];
      this.rebuildHelixThemes();
      await this.saveSettings();
      const parents = result.missingParents.length
        ? ` It builds on ${result.missingParents.map((p) => `"${p}"`).join(", ")}; import that theme too for its full colours.`
        : "";
      new Notice(`Imported "${result.theme.name}" (${result.mappedCaptures} colours).${parents}`, 8000);
    } catch (e) {
      const msg = e instanceof ThemeImportError ? e.message : "Unexpected error; see the developer console.";
      if (!(e instanceof ThemeImportError)) console.error("Treelights: theme import failed", e);
      new Notice(`Could not import ${fileName}: ${msg}`, 8000);
    }
  }

  async removeHelixTheme(themeName: string) {
    this.settings.helixSources = this.settings.helixSources.filter((h) => `${h.name} (Helix)` !== themeName);
    this.rebuildHelixThemes();
    for (const key of ["darkTheme", "lightTheme"] as const) {
      if (this.settings[key] === themeName) this.settings[key] = DEFAULTS[key];
    }
    await this.saveSettings();
  }

  // ---------------------------------------------------------------
  // Reading view

  /** Pattern badges in a rendered inline code element (Reading view). */
  private renderInline(code: HTMLElement) {
    if (code.dataset.treelights || code.children.length) return; // done already, or not plain text
    const text = code.textContent ?? "";
    const runs = this.patternRuns(text).filter((r) => r.chip);
    if (!runs.length) return;
    const frag = createFragment();
    let at = 0;
    for (const r of runs) {
      if (r.from > at) frag.append(text.slice(at, r.from));
      frag.createSpan({ cls: r.cls, text: text.slice(r.from, r.to), attr: badgeAttrs(r.title) });
      at = r.to;
    }
    if (at < text.length) frag.append(text.slice(at));
    code.empty();
    code.append(frag);
    code.dataset.treelights = "inline";
  }

  /**
   * Colour a rendered code block in place. The code is read from the
   * note's source (not from the screen, where other plugins may have added
   * line numbers), and only existing text is wrapped, so other plugins'
   * structure is left alone.
   */
  private async renderReading(code: HTMLElement, section: HTMLElement, ctx: MarkdownPostProcessorContext) {
    if (code.dataset.treelights) return;
    const cls = [...code.classList].find((c) => c.startsWith("language-"));
    const lang = cls ? normaliseLanguage(cls.slice("language-".length)) : "";
    const hasGrammar = !!grammars[lang];
    if (!hasGrammar && !this.patternsOn) return;
    if (hasGrammar) await this.prepareLanguages(lang);

    const source = this.sourceOf(code, section, ctx) ?? code.textContent ?? "";
    const runs = hasGrammar ? this.runs(source, lang) : this.patternRuns(source);
    if (!runs || (!hasGrammar && !runs.length)) return;

    // class for every source character (undefined = no colour)
    const charClass: (string | undefined)[] = new Array(source.length);
    const charTitle: (string | undefined)[] = new Array(source.length);
    for (const r of runs) for (let k = r.from; k < r.to; k++) { charClass[k] = r.cls; charTitle[k] = r.title; }

    // Remove Obsidian's built-in highlighting (Prism "token" spans): its
    // colours are replaced anyway, and its pieces would split Treelights'
    // badges. Other plugins' structure (line numbers, line wrappers) stays.
    // (only when Treelights colours the whole block; otherwise Obsidian's
    // own highlighting stays and only the pattern badges are added)
    if (hasGrammar) {
      for (const tok of Array.from(code.querySelectorAll("span.token"))) tok.replaceWith(...Array.from(tok.childNodes));
    }
    code.normalize(); // join neighbouring text pieces

    // text nodes that hold code (skip line numbers and other widgets)
    const skip = '[class*="line-number"], [class*="linenumber"], [contenteditable="false"], .treelights-skip';
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    // only elements inside the code block count: Obsidian itself puts
    // classes like "show-line-number" on <body>
    const skipped = (el: Element | null) => {
      for (let e = el; e && e !== code; e = e.parentElement) if (e.matches(skip)) return true;
      return false;
    };
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!skipped(n.parentElement)) nodes.push(n as Text);
    }

    // align source characters with on-screen characters; newlines may
    // be represented by line elements instead of characters
    // Align on visible characters only. The screen may show whitespace
    // differently (trimmed, non-breaking, indentation guides), but the
    // visible characters of the code are the same, in the same order.
    // Whitespace on screen stays uncoloured, which does not show.
    const visible: number[] = []; // source index of each visible character
    for (let k = 0; k < source.length; k++) if (!/\s/.test(source[k])) visible.push(k);
    let v = 0;
    for (const node of nodes) {
      const text = node.data;
      const classes: (string | undefined)[] = [];
      const titles: (string | undefined)[] = [];
      for (let j = 0; j < text.length; j++) {
        if (/\s/.test(text[j]) || v >= visible.length) {
          // whitespace inside one coloured run (for example the spaces in
          // "rgb(61 224 255)") takes the run's class, so a chip stays whole
          const prev = v > 0 ? visible[v - 1] : -1, next = v < visible.length ? visible[v] : -1;
          const inside = prev >= 0 && next >= 0 && charClass[prev] && charClass[prev] === charClass[next]
            && charTitle[prev] === charTitle[next] && runs.some((r) => r.from <= prev && next < r.to);
          classes.push(inside ? charClass[prev] : undefined); titles.push(inside ? charTitle[prev] : undefined);
          continue;
        }
        const k = visible[v];
        if (source[k] === text[j]) { classes.push(charClass[k]); titles.push(charTitle[k]); v++; }
        else { classes.push(undefined); titles.push(undefined); } // on-screen only; keep the source position
      }
      if (!classes.some(Boolean)) continue;
      const frag = createFragment();
      let start = 0;
      for (let j = 1; j <= text.length; j++) {
        if (j === text.length || classes[j] !== classes[start] || titles[j] !== titles[start]) {
          const piece = text.slice(start, j);
          if (classes[start]) {
            frag.createSpan({ cls: classes[start], text: piece, attr: badgeAttrs(titles[start]) });
          }
          else frag.append(piece);
          start = j;
        }
      }
      node.replaceWith(frag);
    }
    code.dataset.treelights = lang || "plain";
    code.addClass("treelights");
    this.watchForRebuild(code, section, ctx);
  }

  /**
   * Another plugin may rebuild a code block after Treelights coloured it
   * (Codeblock Customizer adds line numbers this way). Watch briefly and
   * colour again if the colours were wiped, at most three times.
   */
  private watchForRebuild(code: HTMLElement, section: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const tries = Number(code.dataset.treelightsTries ?? 0);
    if (tries >= 3) return;
    const observer = new MutationObserver(() => {
      if (code.querySelector('[class^="tl-"]')) return;
      observer.disconnect();
      code.dataset.treelightsTries = String(tries + 1);
      delete code.dataset.treelights;
      window.requestAnimationFrame(() => void this.renderReading(code, section, ctx));
    });
    observer.observe(code, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 5000);
  }

  /** The code inside a fenced block, read from the note's source. */
  private sourceOf(code: HTMLElement, section: HTMLElement, ctx: MarkdownPostProcessorContext): string | undefined {
    const info = ctx.getSectionInfo(section);
    if (!info) return undefined;
    const lines = info.text.split("\n").slice(info.lineStart, info.lineEnd + 1);
    const open = lines.findIndex((l) => /^\s*(`{3,}|~{3,})/.test(l));
    if (open < 0) return undefined;
    const fence = /^\s*(`{3,}|~{3,})/.exec(lines[open])![1];
    let close = lines.length;
    for (let k = open + 1; k < lines.length; k++) if (lines[k].trimStart().startsWith(fence)) { close = k; break; }
    const body = lines.slice(open + 1, close).join("\n");
    // sanity check: the screen text should contain the source's first word
    const first = body.trim().split(/\s+/)[0] ?? "";
    return code.textContent?.includes(first) ? body : undefined;
  }

  // ---------------------------------------------------------------
  // Live Preview and Source mode

  // the plugin is passed in because the view class has its own "this"
  private livePreviewPlugin(plugin: TreelightsPlugin) {
    return ViewPlugin.fromClass(class {
      decorations: DecorationSet = Decoration.none;
      // Badges and colour chips: "outer" decorations wrap Obsidian's own
      // highlighting instead of being split by it, so each stays one piece
      outer: DecorationSet = Decoration.none;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      private builds: number[] = [];
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged
          || u.transactions.some((t) => t.reconfigured || t.effects.some((e) => e.is(refreshEffect)))) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        // Safety brake: a redraw storm means something is wrong; stop
        // decorating instead of freezing Obsidian.
        const now = Date.now();
        this.builds = this.builds.filter((t) => now - t < 1000);
        this.builds.push(now);
        if (plugin.disabledReason || this.builds.length > 120) {
          if (!plugin.disabledReason) {
            plugin.disabledReason = "more than 120 redraws in one second";
            console.error(`Treelights stopped highlighting in the editor: ${plugin.disabledReason}.`);
          }
          return Decoration.none;
        }
        const builder = new RangeSetBuilder<Decoration>();
        const outerBuilder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        const { from: vFrom, to: vTo } = view.viewport;
        let line = 1;
        while (line <= doc.lines) {
          const open = doc.line(line);
          const m = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(open.text);
          if (!m) {
            // inline code in ordinary lines: pattern features only
            if (plugin.patternsOn && open.to >= vFrom && open.from <= vTo) {
              for (const ic of open.text.matchAll(/(`+)([^`]+?)\1(?!`)/g)) {
                const start = open.from + ic.index + ic[1].length;
                for (const r of plugin.patternRuns(ic[2])) {
                  if (!r.chip) continue;
                  outerBuilder.add(start + r.from, start + r.to, Decoration.mark({ class: r.cls,
                    ...(r.title ? { attributes: badgeAttrs(r.title) } : {}) }));
                }
              }
            }
            line++; continue;
          }
          const fence = m[2];
          const lang = normaliseLanguage(m[3] || "");
          let close = line + 1;
          while (close <= doc.lines && !doc.line(close).text.trimStart().startsWith(fence)) close++;
          const first = line + 1;
          const last = Math.min(close - 1, doc.lines);
          if (first <= last && (grammars[lang] || plugin.patternsOn)) {
            const from = doc.line(first).from;
            const to = doc.line(last).to;
            if (to >= vFrom && from <= vTo) {
              const code = doc.sliceString(from, to);
              const runs = !grammars[lang] ? plugin.patternRuns(code)
                : plugin.languages.get(lang) ? plugin.runs(code, lang) : undefined;
              if (runs) {
                for (const r of runs) {
                  if (r.chip) outerBuilder.add(from + r.from, from + r.to, Decoration.mark({ class: r.cls,
                    ...(r.title ? { attributes: badgeAttrs(r.title) } : {}) }));
                  else builder.add(from + r.from, from + r.to, Decoration.mark({ class: r.cls }));
                }
              } else {
                plugin.requestLanguage(lang); // redraws when loaded
              }
            }
          }
          line = close + 1;
        }
        this.outer = outerBuilder.finish();
        return builder.finish();
      }
    }, {
      decorations: (v) => v.decorations,
      provide: (plugin) => EditorView.outerDecorations.of((view) => view.plugin(plugin)?.outer ?? Decoration.none),
    });
  }
}

/** Separates a badge's label, link and site in its tip key. */
const SEP = "\u0001";
const MOD = Platform.isMacOS ? "⌘" : "Ctrl";

/** Attributes for a pattern badge: its label, and its link if it has one. */
function badgeAttrs(tip: string | undefined): Record<string, string> {
  if (!tip) return {};
  const [label, url, site] = tip.split(SEP);
  if (!url) return { "aria-label": label, "data-tl-tip": label };
  const text = `${label}\n${MOD}-click to open in ${site}`;
  return { "aria-label": text, "data-tl-tip": text, "data-tl-link": url };
}

/** Cmd-click (Ctrl-click elsewhere) on a CVE, CWE or ATT&CK badge opens its page. */
function openBadgeLink(e: MouseEvent) {
  if (e.button !== 0 || !(Platform.isMacOS ? e.metaKey : e.ctrlKey)) return;
  const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tl-link]");
  const url = el?.dataset.tlLink;
  if (!url || !/^https:\/\/(nvd\.nist\.gov|cwe\.mitre\.org|attack\.mitre\.org)\//.test(url)) return;
  e.preventDefault(); e.stopPropagation();
  window.open(url); // Obsidian opens it in the default browser
}

/** Show Obsidian's tooltip for a pattern badge under the mouse. */
function showBadgeTooltip(e: MouseEvent) {
  const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tl-tip]");
  if (!el) return;
  const tip = el.dataset.tlTip!;
  const show = (obsidian as unknown as { displayTooltip?: (el: HTMLElement, text: string) => void }).displayTooltip;
  if (show) show(el, tip); // Obsidian 1.8.7 and later
  else if (!el.dataset.tlTipSet) { setTooltip(el, tip); el.dataset.tlTipSet = "1"; }
}

/** Style slots in styles.css; must match SLOTS in tools/gen-styles.mjs (a test checks). */
export const STYLE_SLOTS = 256;

/** Grammars used only for code inside other code; not listed as languages. */
const INTERNAL_GRAMMARS = new Set(["comment", "luadoc", "luap", "printf", "regex", "query", "markdown_inline", "html_tags", "dtd"]);

class TreelightsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TreelightsPlugin) { super(app, plugin); }

  // Settings are declared as data (Obsidian 1.13+), so each one appears in
  // Obsidian's settings search. Rows with custom behaviour use "render".
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    const custom = new Set(s.customThemes.map((t) => t.name));
    const themes = [...BUILT_IN_THEMES.filter((t) => !custom.has(t.name)), ...s.customThemes];
    const themeOptions = Object.fromEntries(themes.map((t) => [t.name, t.name]));
    const tooLarge = 256 * 1024;

    const sub = (name: string, desc: string, key: "securityIndicators" | "secretWarnings" | "hiddenCharacters"): SettingDefinition => ({
      name, desc, visible: () => s.securityFeatures,
      render: (setting) => {
        setting.setClass("treelights-sub-setting")
          .addToggle((t) => t.setValue(s[key]).onChange(async (v) => { s[key] = v; await this.plugin.saveSettings(); }));
      },
    });

    const names = Object.keys(grammars).filter((g) => !INTERNAL_GRAMMARS.has(g)).sort();
    const aliasesOf = (g: string) => Object.entries(LANGUAGE_ALIASES).filter(([, to]) => to === g).map(([a]) => a);
    const languageList = createFragment((f) => {
      f.createEl("p", { text: "Use the name (or one of the other names in brackets) after the opening ``` of a code block." });
      const ul = f.createEl("ul", { cls: "treelights-language-list" });
      for (const g of names) {
        const alt = aliasesOf(g);
        ul.createEl("li", { text: alt.length ? `${g} (${alt.join(", ")})` : g });
      }
    });

    return [
      {
        type: "group",
        items: [
          { name: "Dark theme", desc: "Used when Obsidian is in dark mode.", control: { type: "dropdown", key: "darkTheme", options: themeOptions } },
          { name: "Light theme", desc: "Used when Obsidian is in light mode.", control: { type: "dropdown", key: "lightTheme", options: themeOptions } },
          {
            name: "Use the theme's background",
            desc: "Give code blocks the background colour of the code theme. (Follow Obsidian theme always keeps the Obsidian theme's background.)",
            control: { type: "toggle", key: "useThemeBackground" },
          },
        ],
      },
      {
        type: "group",
        heading: "Themes",
        items: [
          {
            name: "Import a Helix theme",
            desc: "Choose a Helix theme file (.toml). Treelights reads its colours only; nothing in the file is run.",
            render: (setting) => {
              setting.addButton((b) => b.setButtonText("Choose file").onClick(() => {
                // Settings may be in its own window: the file picker must belong to
                // the same window as the click, or the browser will not open it.
                const doc = b.buttonEl.ownerDocument;
                const input = doc.body.createEl("input", { type: "file", cls: "treelights-file-input", attr: { accept: ".toml" } });
                input.onchange = async () => {
                  const file = input.files?.[0];
                  input.remove();
                  if (!file) return;
                  if (file.size > tooLarge) { new Notice("That file is too large to be a theme."); return; }
                  await this.plugin.importHelixTheme(file.name, await file.text());
                  this.update();
                };
                input.click();
              }));
            },
          },
          {
            name: "Import from your vault",
            desc: "Or put the .toml file in your vault and enter its path, for example themes/tokyonight.toml.",
            render: (setting) => {
              let vaultPath = "";
              setting
                .addText((t) => t.setPlaceholder("themes/name.toml").onChange((v) => { vaultPath = v.trim(); }))
                .addButton((b) => b.setButtonText("Import").onClick(async () => {
                  if (!vaultPath.toLowerCase().endsWith(".toml")) { new Notice("Enter the path of a .toml file in your vault."); return; }
                  if (!(await this.app.vault.adapter.exists(vaultPath))) { new Notice(`No file at ${vaultPath}.`); return; }
                  const stat = await this.app.vault.adapter.stat(vaultPath);
                  if (stat && stat.size > tooLarge) { new Notice("That file is too large to be a theme."); return; }
                  await this.plugin.importHelixTheme(vaultPath.split("/").pop() ?? vaultPath, await this.app.vault.adapter.read(vaultPath));
                  this.update();
                }));
            },
          },
          ...s.customThemes.map((t): SettingDefinition => ({
            name: t.name,
            desc: `Imported Helix theme (${t.type}).`,
            render: (setting) => {
              setting.addButton((b) => b.setButtonText("Remove").setDestructive().onClick(async () => {
                await this.plugin.removeHelixTheme(t.name);
                this.update();
              }));
            },
          })),
        ],
      },
      {
        type: "group",
        heading: "Highlight rules",
        items: [
          {
            name: "LazyVim extras",
            desc: "Extra highlight rules from LazyVim and snacks.nvim, for example `vim` shown as a built-in in Lua.",
            render: (setting) => {
              setting.addToggle((t) => t.setValue(s.packs.includes("lazyvim")).onChange(async (v) => {
                s.packs = v ? [...new Set([...s.packs, "lazyvim"])] : s.packs.filter((p) => p !== "lazyvim");
                this.plugin.rebuildQueries();
                await this.plugin.saveSettings(); // also redraws open notes
              }));
            },
          },
          {
            name: "Colour previews",
            desc: "Show colour codes such as #ff6b1a, rgb() and hsl() on their own colour.",
            control: { type: "toggle", key: "colourPreviews" },
          },
          {
            name: "Security features",
            desc: "Turn on security indicators, secret warnings and hidden-character checks together. Each can then be turned off below.",
            control: { type: "toggle", key: "securityFeatures" },
          },
          sub("Security indicators", "Show indicators as alert badges: IP and MAC addresses, registry keys, file hashes and wallet addresses (red); URLs and domains, also defanged (blue); email addresses and file paths (green); CVE and CWE IDs (amber); MITRE ATT&CK IDs (magenta). Hover over one to see what it is. Cmd-click (Ctrl-click on Windows and Linux) a CVE, CWE or ATT&CK ID to open its page in your browser.", "securityIndicators"),
          sub("Secret warnings", "Flag credentials that should not be kept in notes: cloud and AI provider API keys, GitHub, GitLab and Slack tokens, JSON Web Tokens and private keys. Shown with yellow and black hazard stripes. Treelights only looks; nothing is sent anywhere.", "secretWarnings"),
          sub("Hidden characters", "Make invisible characters visible: zero-width characters, text-direction controls (as used in \"Trojan Source\" attacks), hidden tag text (used to smuggle instructions to AI tools) and look-alike letters from other alphabets inside a word, shown as cyan markers such as ⟨ZWSP⟩.", "hiddenCharacters"),
        ],
      },
      {
        type: "group",
        heading: "Languages",
        items: [
          { name: `${names.length} languages are built in`, desc: languageList, aliases: names.flatMap((g) => [g, ...aliasesOf(g)]) },
        ],
      },
    ];
  }

  /** Save through the plugin, so a change redraws open notes at once. */
  async setControlValue(key: string, value: unknown) {
    const s = this.plugin.settings;
    if (key === "securityFeatures") {
      s.securityFeatures = value === true;
      // turning the switch on with every feature off would do nothing
      if (s.securityFeatures && !s.securityIndicators && !s.secretWarnings && !s.hiddenCharacters) {
        s.securityIndicators = s.secretWarnings = s.hiddenCharacters = true;
      }
    } else {
      (s as unknown as Record<string, unknown>)[key] = value;
    }
    await this.plugin.saveSettings();
    if (key === "securityFeatures") this.update(); // show or hide the three toggles
  }
}
