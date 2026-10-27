import type { EngineNode } from '@ng-native/fabric';
import { domError } from './dom-error.ts';
import { attributeNameOf } from './qualified-name.ts';
import { targetOf } from './processing-instruction.ts';
import { isCDATASection } from './cdata-section.ts';
import { inDocument } from './in-document.ts';

/**
 * `XMLSerializer`: a node as XML, which a chart library exports a drawing with. An element is
 * given the `xmlns` of its namespace where what it is in has another, an element of HTML with
 * nothing in it is closed as `<br />`, any other with nothing in it as `<path/>`, and text and
 * attribute values are escaped as XML has them.
 *
 * ponytail: no prefixes are made up for an attribute in a namespace with none written, and the
 * well-formed flag is not checked. A document is written as its element.
 */

type Dom = EngineNode & {
  readonly localName: string | null;
  readonly prefix: string | null;
  readonly namespaceURI: string | null;
  readonly documentElement?: EngineNode | null;
  readonly nodeType?: number;
  getAttributeNames(): string[];
  getAttribute(name: string): string | null;
};

const HTML = 'http://www.w3.org/1999/xhtml';
const XLINK = 'http://www.w3.org/1999/xlink';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

const VOID = new Set(
  'area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr'.split(
    ' ',
  ),
);
const TEXT: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const ATTRIBUTE: Readonly<Record<string, string>> = {
  ...TEXT,
  '"': '&quot;',
  '\t': '&#x9;',
  '\n': '&#xA;',
  '\r': '&#xD;',
};
const escapeText = (text: string): string => text.replace(/[&<>]/g, (each) => TEXT[each]!);
const escapeAttribute = (text: string): string =>
  text.replace(/[&<>"\t\n\r]/g, (each) => ATTRIBUTE[each]!);

/** An attribute's name in XML: with the prefix of the namespace it is in. */
function attributeName(node: EngineNode, qualified: string): string {
  const { namespace, prefix, localName } = attributeNameOf(node, qualified);
  if (namespace === XML) return `xml:${localName}`;
  if (namespace === XLINK) return `xlink:${localName}`;
  if (namespace === XMLNS) return localName === 'xmlns' ? 'xmlns' : `xmlns:${localName}`;
  return prefix ? `${prefix}:${localName}` : qualified;
}

function attributesOf(node: Dom): string {
  let written = '';
  for (const name of node.getAttributeNames()) {
    if (name === 'xmlns') continue;
    written += ` ${attributeName(node, name)}="${escapeAttribute(node.getAttribute(name) ?? '')}"`;
  }
  return written;
}

function element(node: Dom, inherited: string | null): string {
  const namespace = node.namespaceURI;
  const local = node.localName ?? node.tag;
  const tag = node.prefix ? `${node.prefix}:${local}` : local;
  const declared =
    namespace !== inherited && !node.prefix ? ` xmlns="${escapeAttribute(namespace ?? '')}"` : '';
  const open = `<${tag}${declared}${attributesOf(node)}`;
  const children = inDocument(node);
  if (children.length === 0) {
    if (namespace !== HTML) return `${open}/>`;
    if (VOID.has(local)) return `${open} />`;
  }
  return `${open}>${children.map((child) => serialized(child, namespace)).join('')}</${tag}>`;
}

function serialized(node: EngineNode, inherited: string | null): string {
  if (node.nodeKind === 'text') {
    return isCDATASection(node) ? `<![CDATA[${node.nodeText}]]>` : escapeText(node.nodeText ?? '');
  }
  if (node.nodeKind !== 'element') {
    const target = targetOf(node);
    return target === undefined
      ? `<!--${node.nodeText ?? ''}-->`
      : `<?${target} ${node.nodeText}?>`;
  }
  return element(node as Dom, inherited);
}

export class XMLSerializer {
  serializeToString(...args: unknown[]): string {
    const given = args[0] as Dom | null | undefined;
    if (args.length === 0 || given === null || typeof given !== 'object') {
      throw new TypeError("Failed to execute 'serializeToString': 1 argument required.");
    }
    if (given.nodeType === 9) {
      return given.documentElement ? serialized(given.documentElement, null) : '';
    }
    if (!('nodeKind' in given)) throw domError('That is no node to write.', 'InvalidStateError');
    return serialized(given, null);
  }
}
