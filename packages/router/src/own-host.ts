/**
 * Claiming a host node, for the elements navigation owns.
 *
 * The engine reports any registered element name that reaches a commit without a component
 * behind it, which is how a template that forgot an import is caught. Navigation's elements need
 * the same treatment for the opposite reason: the outlet creates a `screen` itself, and the
 * header components own theirs, so both are accounted for rather than reported.
 *
 * This duplicates a few lines of the components package on purpose. `@nx/enforce-module-boundaries`
 * keeps the Angular-facing packages from reaching into each other, and a package dependency is a
 * heavier price than the copy.
 */
import { reflectComponentType, type Type } from '@angular/core';
import { claimHost, type EngineNode } from '@ng-native/fabric';

/**
 * Mark `node` as owned, and take off any prop Angular wrote there from a static attribute that
 * one of `component`'s inputs already consumed: `<native-header title="Settings">` feeds the
 * input *and* writes a `title` attribute, and only the input's value should survive.
 *
 * The inputs come from `reflectComponentType`, by the name a template writes (an alias where
 * there is one), so this reads no Angular internals. It throws for a type that is not a
 * component, which has no public mirror, rather than leaving the attributes' props in place.
 */
export function ownHost<T>(node: T, component?: unknown): T {
  claimHost(node as EngineNode);
  if (component) {
    // Callers pass `this.constructor`, which TypeScript types as `Function`.
    const type = component as Type<unknown>;
    const mirror = reflectComponentType(type);
    if (!mirror) throw new Error(`ownHost: ${type.name} is not a component.`);
    for (const { templateName } of mirror.inputs) delete (node as EngineNode).props[templateName];
  }
  return node;
}
