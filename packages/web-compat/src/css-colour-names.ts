import { isNamedColor } from '@ng-native/fabric';
import type { Part } from './css-grammar.ts';

/**
 * Whether one part of a value is a colour (https://drafts.csswg.org/css-color-4/#color-syntax):
 * a name, a system colour, `currentcolor`, a hex colour, or a colour function.
 *
 * ponytail: a colour function is taken by its name; what is in its brackets is not checked.
 */

const SYSTEM = new Set([
  ...['accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface'],
  ...['buttontext', 'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight'],
  ...['highlighttext', 'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext'],
  ...['visitedtext', 'activeborder', 'activecaption', 'appworkspace', 'background'],
  ...['buttonhighlight', 'buttonshadow', 'captiontext', 'inactiveborder', 'inactivecaption'],
  ...['inactivecaptiontext', 'infobackground', 'infotext', 'menu', 'menutext', 'scrollbar'],
  ...['threeddarkshadow', 'threedface', 'threedhighlight', 'threedlightshadow'],
  ...['threedshadow', 'window', 'windowframe', 'windowtext', 'currentcolor', 'transparent'],
  '-webkit-link',
  '-webkit-focus-ring-color',
  '-internal-quirk-inherit',
]);

const FUNCTIONS = new Set([
  ...['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'],
  ...['color-mix', 'light-dark', 'contrast-color', 'device-cmyk', '-webkit-color'],
]);

export function isColour(part: Part): boolean {
  const { token } = part;
  if (token.type === 'hash') return /^([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(token.value);
  if (token.type === 'ident') {
    // In ASCII case only: the Kelvin sign is no `k`.
    if (/[^\x00-\x7f]/.test(token.value)) return false;
    const name = token.value.toLowerCase();
    return SYSTEM.has(name) || isNamedColor(name);
  }
  return token.type === 'function' && FUNCTIONS.has(token.value.toLowerCase());
}

/**
 * The system colours as Chrome draws them in a light scheme, which a computed style writes in
 * place of the name, and the engine is given in place of it.
 */
export const SYSTEM_COLOURS: Readonly<Record<string, string>> = {
  accentcolor: 'rgb(0, 117, 255)',
  accentcolortext: 'rgb(255, 255, 255)',
  activetext: 'rgb(255, 0, 0)',
  buttonborder: 'rgb(118, 118, 118)',
  buttonface: 'rgb(239, 239, 239)',
  buttontext: 'rgb(0, 0, 0)',
  canvas: 'rgb(255, 255, 255)',
  canvastext: 'rgb(0, 0, 0)',
  field: 'rgb(255, 255, 255)',
  fieldtext: 'rgb(0, 0, 0)',
  graytext: 'rgb(128, 128, 128)',
  highlight: 'rgb(181, 213, 255)',
  highlighttext: 'rgb(0, 0, 0)',
  linktext: 'rgb(0, 0, 238)',
  mark: 'rgb(255, 255, 0)',
  marktext: 'rgb(0, 0, 0)',
  selecteditem: 'rgb(0, 117, 255)',
  selecteditemtext: 'rgb(255, 255, 255)',
  visitedtext: 'rgb(85, 26, 139)',
  activeborder: 'rgb(255, 255, 255)',
  activecaption: 'rgb(255, 255, 255)',
  appworkspace: 'rgb(255, 255, 255)',
  background: 'rgb(255, 255, 255)',
  buttonhighlight: 'rgb(239, 239, 239)',
  buttonshadow: 'rgb(239, 239, 239)',
  captiontext: 'rgb(0, 0, 0)',
  inactiveborder: 'rgb(255, 255, 255)',
  inactivecaption: 'rgb(255, 255, 255)',
  inactivecaptiontext: 'rgb(128, 128, 128)',
  infobackground: 'rgb(255, 255, 255)',
  infotext: 'rgb(0, 0, 0)',
  menu: 'rgb(255, 255, 255)',
  menutext: 'rgb(0, 0, 0)',
  scrollbar: 'rgb(255, 255, 255)',
  threeddarkshadow: 'rgb(118, 118, 118)',
  threedface: 'rgb(239, 239, 239)',
  threedhighlight: 'rgb(118, 118, 118)',
  threedlightshadow: 'rgb(118, 118, 118)',
  threedshadow: 'rgb(118, 118, 118)',
  window: 'rgb(255, 255, 255)',
  windowframe: 'rgb(118, 118, 118)',
  windowtext: 'rgb(0, 0, 0)',
};
