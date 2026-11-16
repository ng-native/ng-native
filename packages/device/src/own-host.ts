/**
 * Claiming a host node, and taking off the attributes its inputs consumed.
 *
 * Internal: it lives here because `@ng-native/components` and `@ng-native/router` both own host
 * nodes and cannot import each other.
 */
import { isDevMode, reflectComponentType, ɵgetDirectiveDef, type Type } from '@angular/core';
import { claimHost, type EngineNode } from '@ng-native/fabric';

/** A class's inputs, by the names a template writes. */
interface HostInputs {
  readonly names: ReadonlySet<string>;
  /**
   * Whether a static attribute by one of those names was consumed by them. Not for a directive
   * with no selector: it is only ever a `hostDirectives` entry, which exposes the inputs its host
   * lists and no others, so an attribute named after the rest was not consumed.
   */
  readonly consumes: boolean;
}

const NONE: HostInputs = { names: new Set(), consumes: false };

/** Per class, as the inputs of a class do not change, except under a hot reload (see below). */
const cache = new WeakMap<object, HostInputs>();

/**
 * The inputs of a component or a directive, by the names a template writes (an alias where there
 * is one), inherited ones included. Empty for a class that is neither.
 *
 * A component's come from the public `reflectComponentType`. Angular has no public mirror of a
 * directive, which is what most host primitives are, so a directive's are read from its exported
 * `ɵgetDirectiveDef`.
 */
export function hostInputNames(type: unknown): ReadonlySet<string> {
  return inputsOf(type).names;
}

function inputsOf(type: unknown): HostInputs {
  if (typeof type !== 'function') return NONE;
  const cached = cache.get(type);
  if (cached) return cached;
  const mirror = reflectComponentType(type as Type<unknown>);
  if (mirror) {
    const inputs = {
      names: new Set(mirror.inputs.map((input) => input.templateName)),
      consumes: true,
    };
    // A hot reload replaces a component's definition in place, under the same class, so in
    // development a component's inputs are read again for each host.
    if (!isDevMode()) cache.set(type, inputs);
    return inputs;
  }
  const def = ɵgetDirectiveDef(type);
  const inputs = def
    ? { names: new Set(Object.keys(def.inputs)), consumes: def.selectors.length > 0 }
    : NONE;
  cache.set(type, inputs);
  return inputs;
}

/**
 * Mark `node` as owned, and take off any prop Angular wrote there from a static attribute that
 * one of `type`'s inputs already consumed. Angular writes a static attribute to the element as
 * well as feeding it to the input of the same name, so `<switch thumbColor="#fff">` leaves a
 * stray `thumbColor` prop next to the `thumbTintColor` the input produces, and
 * `<native-header title="Settings">` a `title` prop. A host binding puts back any that native
 * does read.
 *
 * Walking the *node's* props rather than the inputs is not a detail. This runs for every element
 * on screen, a primitive declares some forty-five inputs, and at this point the node usually has
 * no props at all: bindings have not run yet, so only static attributes are there. The other way
 * round it was forty-five `delete`s per element on an object that had none of them, which is both
 * wasted work and the way to push an object into dictionary mode.
 *
 * Never throws: a node with no props bag yet (a host that has not put one there) and a class that
 * is neither a component nor a directive are claimed and otherwise left alone.
 */
export function ownHost<T>(node: T, type?: unknown): T {
  claimHost(node as EngineNode);
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return node;
  const { names, consumes } = inputsOf(type);
  if (!consumes) return node;
  for (const name of Object.keys(props)) {
    if (names.has(name)) delete props[name];
  }
  return node;
}
