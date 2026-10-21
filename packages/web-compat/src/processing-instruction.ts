import type { Engine, EngineNode } from '@ng-native/fabric';
import { createComment } from './character-data.ts';
import { domError, required } from './dom-error.ts';
import { checkXmlName } from './qualified-name.ts';

/**
 * `ProcessingInstruction`: `<?target data?>`, as `document.createProcessingInstruction` makes
 * one. Like a comment it is never drawn, so it is the engine's anchor as a comment is, with its
 * data as its words and its target noted beside it: `CharacterData`'s members work on it as they
 * do on a comment's.
 */

/** The target of each processing instruction, by its anchor. */
const targets = new WeakMap<EngineNode, string>();

/** The target of a processing instruction, or nothing for any other node. */
export const targetOf = (node: EngineNode): string | undefined => targets.get(node);

export const isProcessingInstruction = (node: EngineNode): boolean => targets.has(node);

/** A copy of a processing instruction is one with the same target. */
export function copyTarget(from: EngineNode, to: EngineNode): void {
  const target = targets.get(from);
  if (target !== undefined) targets.set(to, target);
}

/** `createProcessingInstruction`: refused where the target is no XML name or the data ends it. */
export function createProcessingInstruction(engine: Engine, args: unknown[]): EngineNode {
  required(args, 2, 'createProcessingInstruction');
  const target = checkXmlName(String(args[0]));
  const data = String(args[1]);
  if (data.includes('?>')) {
    throw domError(`'${data}' would end the instruction.`, 'InvalidCharacterError');
  }
  const node = createComment(engine, data);
  targets.set(node, target);
  return node;
}
