/**
 * The example apps' own files, for the code browser on each app's page.
 *
 * Read off disk at build time from each registry entry's `sourceRoot`, so the page shows the code
 * in the repository rather than a copy of it. Two virtual modules:
 *
 * - `virtual:angular-native/example-sources` lists every app's files, each with a loader;
 * - each loader imports one file, highlighted by `markdown.ts`'s Shiki, as its own chunk.
 *
 * One chunk per file rather than one per app, because an app's highlighted source runs to
 * hundreds of kilobytes and a reader opens a few files, not all of them.
 *
 * What counts as source: text files an author wrote. Dependencies, native projects, build output,
 * lockfiles, generated files and anything dot-prefixed (`.expo`, `.angular-native`) are left out.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { EXAMPLE_APPS } from '../src/example-apps/registry.ts';
import { highlight } from './markdown.ts';

const INDEX = 'virtual:angular-native/example-sources';
const FILE = 'virtual:angular-native/example-source/';
/** Ends a file's module id, so no plugin reads `home.ts` in the id as a TypeScript module. */
const FILE_SUFFIX = '.highlighted';

const SKIPPED_FOLDERS = new Set(['node_modules', 'ios', 'android', 'dist', 'build']);
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb']);
const GENERATED = /\.generated\.|^expo-env\.d\.ts$/;

/** Extension to Shiki language. Anything else is not shown. */
const LANGUAGE: Record<string, string> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.md': 'md',
};

/**
 * A component's decorator, at the start of a line so a comment mentioning one does not count.
 *
 * `angular-ts` only differs from `ts` inside a decorator's `template` and `styles`, and only a
 * component has those, so a service or a plain module is highlighted as TypeScript.
 */
const COMPONENT = /^\s*@Component\s*\(/m;
/** A `templateUrl` as written, with whichever quotes. */
const TEMPLATE_URL = /\btemplateUrl\s*:\s*(['"`])([^'"`]+)\1/g;

/** An app's source files, as paths relative to its folder with forward slashes, sorted. */
export function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(relative);
      } else if (
        entry.isFile() &&
        path.extname(entry.name) in LANGUAGE &&
        !LOCKFILES.has(entry.name) &&
        !GENERATED.test(entry.name)
      ) {
        files.push(relative);
      }
    }
  };
  walk('');
  return files.sort();
}

/**
 * The `.html` files an app's `.ts` files name as a `templateUrl`, as paths relative to its folder.
 *
 * A template is known by what points at it rather than by its contents: HTML that happens to have
 * no Angular syntax in it yet is still a template, and an `index.html` is not one.
 */
function templates(root: string): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(root)) {
    if (path.extname(file) !== '.ts') continue;
    for (const [, , url] of readFileSync(path.join(root, file), 'utf8').matchAll(TEMPLATE_URL)) {
      found.add(path.posix.join(path.posix.dirname(file), url!));
    }
  }
  return found;
}

/** The Shiki language a file is highlighted as: Angular's, for a component and its template. */
export function languageOf(root: string, file: string): string {
  const extension = path.extname(file);
  if (extension === '.ts' && COMPONENT.test(readFileSync(path.join(root, file), 'utf8'))) {
    return 'angular-ts';
  }
  if (extension === '.html' && templates(root).has(file)) return 'angular-html';
  return LANGUAGE[extension] ?? 'text';
}

/** One file, highlighted. */
export function highlightFile(root: string, file: string): Promise<string> {
  const text = readFileSync(path.join(root, file), 'utf8');
  return highlight(text.trimEnd() + '\n', languageOf(root, file));
}

export function exampleSources(workspaceRoot: string): Plugin {
  const rootOf = (slug: string) => {
    const app = EXAMPLE_APPS.find((entry) => entry.slug === slug);
    if (!app) throw new Error(`No example app "${slug}" in src/example-apps/registry.ts`);
    return path.join(workspaceRoot, app.sourceRoot);
  };

  return {
    name: 'angular-native-docs-example-sources',
    enforce: 'pre',
    resolveId(id) {
      if (id === INDEX || id.startsWith(FILE)) return `\0${id}`;
      return undefined;
    },
    async load(id) {
      if (id === `\0${INDEX}`) {
        const apps = EXAMPLE_APPS.map((app) => {
          const files = sourceFiles(rootOf(app.slug)).map((file) => {
            const module = JSON.stringify(`${FILE}${app.slug}/${file}${FILE_SUFFIX}`);
            return `{ path: ${JSON.stringify(file)}, load: () => import(${module}).then((m) => m.default) }`;
          });
          return `${JSON.stringify(app.slug)}: [\n    ${files.join(',\n    ')}\n  ]`;
        });
        return `export const EXAMPLE_SOURCES = {\n  ${apps.join(',\n  ')}\n};\n`;
      }
      if (id.startsWith(`\0${FILE}`) && id.endsWith(FILE_SUFFIX)) {
        const [slug = '', ...rest] = id.slice(FILE.length + 1, -FILE_SUFFIX.length).split('/');
        const root = rootOf(slug);
        const file = rest.join('/');
        this.addWatchFile(path.join(root, file));
        return `export default ${JSON.stringify(await highlightFile(root, file))};\n`;
      }
      return undefined;
    },
  };
}
