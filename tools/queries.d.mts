/** Query files for a language and kind, inherited files first. */
export function queryFiles(root: string, lang: string, kind: string, seen?: Set<string>): string[];
