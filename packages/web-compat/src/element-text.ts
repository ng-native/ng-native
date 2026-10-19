import type { EngineNode } from '@ng-native/fabric';
import { own, type Reflecting, type Reflection } from './reflect.ts';
import { inDocument } from './in-document.ts';

/**
 * The `text` of the HTML elements that have one: a link's, a script's, a title's and an option's,
 * each its text read as HTML says. A body's is the `text` attribute, in `reflected-attributes.ts`.
 */

type Texted = Reflecting & { textContent: string; localName?: string };

/** The data of the texts directly in a node: HTML's "child text content". */
const childText = (node: EngineNode): string =>
  inDocument(node)
    .filter((child) => child.nodeKind === 'text')
    .map((child) => child.nodeText)
    .join('');

const isScript = (node: EngineNode): boolean =>
  node.nodeKind === 'element' && ((node as Texted).localName ?? node.tag) === 'script';

/** The data of every text under a node, in order, less what is in a script under it. */
function textOutsideScripts(node: EngineNode): string {
  let text = '';
  for (const child of inDocument(node)) {
    if (child.nodeKind === 'text') text += child.nodeText;
    else if (!isScript(child)) text += textOutsideScripts(child);
  }
  return text;
}

/** HTML's "strip and collapse ASCII whitespace". */
const collapsed = (text: string): string => text.replace(/[\t\n\f\r ]+/g, ' ').trim();

/** Set, it is what the element holds, as `textContent` set is. */
const setText = (node: Reflecting, value: unknown): void => {
  (node as Texted).textContent = String(value);
};

const childTextContent = own(childText, setText);

export const ELEMENT_TEXT: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  a: { text: own((node) => (node as Texted).textContent, setText) },
  script: { text: childTextContent },
  title: { text: childTextContent },
  option: { text: own((node) => collapsed(textOutsideScripts(node)), setText) },
};
