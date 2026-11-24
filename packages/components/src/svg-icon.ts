/**
 * The `{ svg }` form of a `ButtonIcon`: an icon's SVG markup, such as an `@ng-icons` set's, which
 * the macOS and Linux hosts draw as their own icon (a template image AppKit tints, and a symbolic
 * icon GTK draws in the text colour). They take it as the `svgIcon` prop.
 */
import { nativePlatform } from '@ng-native/fabric';
import type { ButtonIcon } from './native-button.ts';

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

/** A picture as a menu item or a tray icon sends it: each form under the key the host reads. */
export interface IconFields {
  readonly sfSymbol?: string;
  /** A drawable resource's name, which Android draws. */
  readonly icon?: string;
  readonly svgIcon?: string;
}

/**
 * The fields for an element's `sfSymbol` and `icon` inputs, where `icon` is a `ButtonIcon` or, as it
 * was before it took one, a drawable's name. The `sfSymbol` input wins over an `icon` of
 * `{ sfSymbol }`, as on `<native-button>`. Says what `svgIconMarkup` says.
 */
export function iconFields(
  sfSymbol: string | undefined,
  icon: string | ButtonIcon | undefined,
  element: string,
  offDesktop = false,
): IconFields {
  const given = typeof icon === 'string' ? { drawable: icon } : icon;
  const symbol = sfSymbol || (given && 'sfSymbol' in given ? given.sfSymbol : undefined);
  const drawable = given && 'drawable' in given ? given.drawable : undefined;
  const svgIcon = svgIconMarkup(given, element, offDesktop);
  return {
    ...(symbol && { sfSymbol: symbol }),
    ...(drawable && { icon: drawable }),
    ...(svgIcon && { svgIcon }),
  };
}
