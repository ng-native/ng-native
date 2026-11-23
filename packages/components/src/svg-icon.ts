/**
 * The `{ svg }` form of a `ButtonIcon`: an icon's SVG markup, such as an `@ng-icons` set's, which
 * the macOS and Linux hosts draw as their own icon (a template image AppKit tints, and a symbolic
 * icon GTK draws in the text colour). They take it as the `svgIcon` prop.
 */
import { nativePlatform } from '@ng-native/fabric';

declare const ngDevMode: unknown;

/** What was already said, so a list of rows says it once. */
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if ((typeof ngDevMode !== 'undefined' && !ngDevMode) || warned.has(key)) return;
  warned.add(key);
  console.warn(`[angular-native] ${message}`);
}

/**
 * The markup to commit as `svgIcon` for an icon, or undefined when it is not `{ svg }`. Says once,
 * in development, when the markup is no `<svg>` element (the icon's name in place of its markup is
 * the usual slip), and with `offDesktop` when the platform running draws a symbol or a drawable for
 * the element but no SVG, since either shows no icon.
 */
export function svgIconMarkup(
  icon: { readonly svg?: string } | object | undefined,
  element: string,
  offDesktop = false,
): string | undefined {
  if (!icon || !('svg' in icon) || typeof icon.svg !== 'string') return undefined;
  const markup = icon.svg;
  if (!/<svg[\s/>]/i.test(markup)) {
    warnOnce(
      `markup:${markup}`,
      `<${element}> was given an SVG icon that is no <svg> element, so it shows none: ` +
        `"${markup.slice(0, 40)}". Pass the icon's markup, such as the string ` +
        `@ng-icons/lucide exports, not its name.`,
    );
  }
  const os = nativePlatform();
  if (offDesktop && os !== 'macos' && os !== 'linux') {
    warnOnce(
      `platform:${element}:${os}`,
      `<${element}> draws an SVG icon on macOS and Linux only, so on ${os} it shows none. ` +
        `Give it { sfSymbol } or { drawable } there.`,
    );
  }
  return markup;
}
