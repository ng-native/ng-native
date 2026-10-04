/**
 * A Node module hook that compiles Angular for `node --test`, the way the Metro transformer does
 * for the app. `register.mjs` installs it; see `compile.mjs` for which files need it and why.
 *
 * A `.md` file is imported as Metro imports it: see `compileMarkdown`.
 *
 * One more job than the Vitest plugin has: Node refuses to strip types from a `.ts` file under
 * `node_modules` at all, and that is exactly where an installed `@ng-native/*` package's source
 * lives. So every `.ts` there is loaded here, compiled if it is decorated and stripped either way.
 *
 * `initialize` takes `{ skip: string[] }` - URL fragments whose TypeScript is left to Node, for a
 * suite that compiles some files itself. This workspace's integration suite uses it for its
 * fixtures and generated copies; an app has no reason to.
 *
 * `web: string[]` does the same for files compiled as Metro compiles for the browser - a
 * `<dom-component>`'s own component, whose CSS a web view applies rather than native.
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileAngular, compileMarkdown, needsAngular, stubAssets } from './compile.mjs';

/** @type {string[]} */
let skip = [];
/** @type {string[]} */
let web = [];

/** @param {{ skip?: string[], web?: string[] } | undefined} data */
export function initialize(data) {
  skip = data?.skip ?? [];
  web = data?.web ?? [];
}

/**
 * @param {string} url
 * @param {{ format?: string }} context
 * @param {(url: string, context: object) => Promise<{ format?: string, source?: string | ArrayBuffer | Uint8Array }>} nextLoad
 */
export async function load(url, context, nextLoad) {
  const installed = url.includes('/node_modules/');

  if (url.startsWith('file:') && new URL(url).pathname.endsWith('.md')) {
    const file = fileURLToPath(url);
    return {
      format: 'module',
      source: compileMarkdown(readFileSync(file, 'utf8'), file),
      shortCircuit: true,
    };
  }

  if (url.startsWith('file:') && url.endsWith('.ts') && !skip.some((part) => url.includes(part))) {
    const loaded = loadTypeScript(fileURLToPath(url), installed);
    if (loaded) return loaded;
  }

  const result = await nextLoad(url, context);
  if (!installed || result.format !== 'module') return result;

  // Any package, not only Angular's own: `@ng-icons/core` ships partial-compiled too.
  const source = result.source?.toString();
  if (!source || !needsAngular(source, url)) return result;
  return { ...result, source: compileAngular(source, fileURLToPath(url)).code };
}

/**
 * A `.ts` file this hook has to handle itself: decorated, installed, or requiring an asset. Any
 * other is left to Node, which strips types faster than this does.
 *
 * @param {string} file
 * @param {boolean} installed
 */
function loadTypeScript(file, installed) {
  const read = readFileSync(file, 'utf8');
  const source = installed ? read : stubAssets(read);
  const decorated = needsAngular(source, file);
  if (!decorated && !installed && source === read) return null;
  const platform = web.some((part) => file.includes(part)) ? 'web' : undefined;
  const code = decorated ? compileAngular(source, file, { platform }).code : source;
  return {
    format: 'module',
    source: stripTypeScriptTypes(code, { mode: 'strip' }),
    shortCircuit: true,
  };
}
