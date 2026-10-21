import type { EngineNode } from '@ng-native/fabric';
import { required } from './dom-error.ts';
import { closest, matches, queryUnder } from './selector.ts';

/**
 * The members of a node for the selectors a script asks with: `matches`, and the prefixed name
 * older libraries call it by, `closest`, `querySelector` and `querySelectorAll`. See
 * `selector.ts`.
 */

const method = (value: (this: EngineNode, ...args: unknown[]) => unknown) => ({
  value,
  writable: true,
});

export const selectorMembers: PropertyDescriptorMap = {
  matches: method(function (...args) {
    required(args, 1, 'matches');
    return matches(this, args[0]);
  }),
  webkitMatchesSelector: method(function (...args) {
    required(args, 1, 'webkitMatchesSelector');
    return matches(this, args[0]);
  }),
  closest: method(function (...args) {
    required(args, 1, 'closest');
    return closest(this, args[0]);
  }),
  querySelectorAll: method(function (...args) {
    required(args, 1, 'querySelectorAll');
    return queryUnder(this, args[0], false);
  }),
  querySelector: method(function (...args) {
    required(args, 1, 'querySelector');
    return queryUnder(this, args[0], true)[0] ?? null;
  }),
};
