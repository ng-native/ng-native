/**
 * Reading a Metro development bundle as its modules, for the device test host to define again only
 * what an edit changed. Plain functions, so they run in Node's tests as well as in the app.
 */

export interface BundleModule {
  id: number;
  /** The module's path as Metro names it, from the project root: `src/app/home.ts`. */
  name: string;
  /** Its `__d(...)` call, as Metro sent it. */
  code: string;
  /** The line of the bundle it starts on, from 0: where a stack in it is mapped from. */
  line: number;
}

/** The end of one module's definition: `},<id>,[<dependencies>],"<name>");`. */
const MODULE_END = /\},(\d+),\[[\d,]*\],"((?:[^"\\]|\\.)*)"\);?/;

/** Each module a bundle defines, in order. What follows the last one (`__r(...)`) is left out. */
export function modulesOf(text: string): BundleModule[] {
  const modules: BundleModule[] = [];
  let line = 0;
  for (const chunk of text.split(/\n(?=__d\()/)) {
    const start = line;
    line += lines(chunk) + 1;
    if (!chunk.startsWith('__d(')) continue;
    // The last match: a module's code can contain the same shape inside a string.
    let end: RegExpExecArray | null = null;
    const pattern = new RegExp(MODULE_END.source, 'g');
    for (let match = pattern.exec(chunk); match; match = pattern.exec(chunk)) end = match;
    if (!end) continue;
    modules.push({
      id: Number(end[1]),
      name: JSON.parse(`"${end[2]}"`) as string,
      code: chunk.slice(0, end.index + end[0].length),
      line: start,
    });
  }
  return modules;
}

/** What a module record holds of its imports: their ids, as an array or an object's values. */
export interface ModuleRecord {
  dependencyMap?: unknown[] | Record<string, unknown>;
}

/** Every module that imports one of `ids`, directly or through others; `ids` themselves left out. */
export function dependents(modules: Map<number, ModuleRecord>, ids: Set<number>): Set<number> {
  const importers = new Map<number, number[]>();
  for (const [id, mod] of modules) {
    const map = mod.dependencyMap ?? [];
    for (const dependency of Array.isArray(map) ? map : Object.values(map)) {
      if (typeof dependency !== 'number') continue;
      importers.set(dependency, [...(importers.get(dependency) ?? []), id]);
    }
  }
  const found = new Set<number>();
  const queue = [...ids];
  while (queue.length) {
    for (const importer of importers.get(queue.pop()!) ?? []) {
      if (!found.has(importer) && !ids.has(importer)) {
        found.add(importer);
        queue.push(importer);
      }
    }
  }
  return found;
}

function lines(text: string): number {
  let count = 0;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) count++;
  return count;
}

/**
 * Modules as one script whose every module sits on the line it has in the bundle, named by the
 * bundle's URL, so a stack in it is mapped by Metro as one in the bundle would be.
 */
export function scriptOf(modules: { code: string; line: number }[], url: string): string {
  const parts: string[] = [];
  let line = 0;
  for (const { code, line: start } of [...modules].sort((a, b) => a.line - b.line)) {
    if (start > line) parts.push('\n'.repeat(start - line));
    parts.push(code, '\n');
    line = start + lines(code) + 1;
  }
  parts.push(`//# sourceURL=${url}`);
  return parts.join('');
}
