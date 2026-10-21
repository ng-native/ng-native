import type { Engine, EngineNode } from '@ng-native/fabric';
import { domError, required } from './dom-error.ts';

/**
 * `CDATASection`: `<![CDATA[...]]>`, a text of an XML document's, as `createCDATASection` makes
 * one there. It is the engine's text as any other is, noted as one of these beside it, so it
 * reads and changes as a text does and answers `nodeType` 4.
 */
const sections = new WeakSet<EngineNode>();

export const isCDATASection = (node: EngineNode): boolean => sections.has(node);

/** A copy of a section is one too. */
export function copySection(from: EngineNode, to: EngineNode): void {
  if (sections.has(from)) sections.add(to);
}

/**
 * `createCDATASection`: refused in an HTML document, which has none, and where the data would
 * end the section.
 */
export function createCDATASection(engine: Engine, args: unknown[], html: boolean): EngineNode {
  required(args, 1, 'createCDATASection');
  if (html) throw domError('An HTML document has no CDATA sections.', 'NotSupportedError');
  const data = String(args[0]);
  if (data.includes(']]>')) {
    throw domError(`'${data}' would end the section.`, 'InvalidCharacterError');
  }
  const node = engine.createText(data);
  sections.add(node);
  return node;
}
