/**
 * `import source from './button-variants.ts?source'` - a component's own text, highlighted.
 *
 * An example page shows a component running and shows the code that produced it, and the only
 * honest way to do the second is to read the first. Anything retyped into a markdown fence is a
 * copy that stops being true the moment the example is edited, and nothing fails when it does.
 *
 * Highlighted by `markdown.ts`'s Shiki, so an example's code and a code block in a page are the
 * same kind of block, and at build time for the same reason: the site should not ship a syntax
 * highlighter to render text that was already known at build time.
 */
import type { Plugin } from 'vite';
import { excerpt, withoutMarkers } from './excerpt.ts';
import { highlight } from './markdown.ts';

const SUFFIX = '?source';
/** `?excerpt`: only the region the file marks, in the language it names; see `excerpt.ts`. */
const EXCERPT = '?excerpt';

export function source(): Plugin {
  return {
    name: 'angular-native-docs-source',
    enforce: 'pre',
    async load(id) {
      const suffix = [SUFFIX, EXCERPT].find((end) => id.endsWith(end));
      if (!suffix) return undefined;
      const file = id.slice(0, -suffix.length);
      const text = await import('node:fs/promises').then((fs) => fs.readFile(file, 'utf8'));
      const region = suffix === EXCERPT ? excerpt(text) : undefined;
      const shown = region ? region.text : trimLicenceHeader(withoutMarkers(text));
      const html = await highlight(shown, region?.lang ?? 'ts');
      return (
        `export const text = ${JSON.stringify(shown)};\n` +
        `export const html = ${JSON.stringify(html)};\n` +
        `export default html;\n`
      );
    },
  };
}

/**
 * Drops a leading block comment.
 *
 * Every example file in this app opens with a note explaining what it is showing, which belongs
 * to the page rather than to the code a reader would paste into their own project.
 */
function trimLicenceHeader(text: string): string {
  const match = /^\s*\/\*[\s\S]*?\*\/\s*/.exec(text);
  return (match ? text.slice(match[0].length) : text).trimEnd() + '\n';
}
