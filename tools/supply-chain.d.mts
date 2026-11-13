// Types for tools/supply-chain.mjs (used by the tests)
export const root: string;
export const checksumsFile: string;
export const platform: string;
export const ALLOWED_IMPORTS: Set<string>;
export function sha256(bytes: Uint8Array): string;
export function sha256File(file: string): string;
export function sha256Tree(dir: string): string;
export function forbiddenImports(wasmBytes: Uint8Array): Promise<string[]>;
export function embeddedJavaScript(wasmBytes: Uint8Array): Promise<string[]>;
export function checkTools(options?: { update?: boolean }): string[];
export function checkGrammars(langs: string[], wasmDir: string, options?: { update?: boolean }): Promise<string[]>;
export function stopOn(problems: string[], what: string): void;
