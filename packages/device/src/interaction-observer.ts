/**
 * Interactions as plain events, for an analytics or monitoring tool to record.
 *
 * Such a tool usually learns about taps by wrapping React Native's own `Pressable` and
 * `ScrollView`, which never render here: every control is a host view on the press machine in
 * `@ng-native/components`, or a view the platform draws, such as an `@expo/ui` control or a native
 * tab. So the control says what happened, and an app maps it to whatever its tool takes. Nothing is
 * built while no observer is registered.
 *
 * Here rather than in `@ng-native/components` because `@ng-native/expo` and `@ng-native/router`
 * report too, and the Angular-facing packages cannot import each other.
 */
import { InjectionToken, type Injector, type Provider } from '@angular/core';
import {
  registeredViewName,
  type EngineNode,
  type HostEngine,
  type HostNode,
} from '@ng-native/fabric';

/**
 * What the user did. `gesture` is a native gesture that is none of the others: a slow pan, a
 * pinch, a rotation.
 */
export type InteractionType = 'click' | 'long-press' | 'scroll' | 'swipe' | 'gesture';

/**
 * Which way a scroll view's drag moved the content into view (`down` shows what is below), or
 * which way a native gesture's finger moved (`down` is towards the bottom of the screen).
 */
export type InteractionDirection = 'up' | 'down' | 'left' | 'right';

/**
 * The native gesture an event came from: the builder's name, `Gesture.LongPress()` as
 * `long-press`. A string, so a gesture added to the library later still has a name.
 */
export type InteractionGesture =
  'tap' | 'long-press' | 'pan' | 'fling' | 'pinch' | 'rotation' | 'manual' | (string & {});

/** One interaction, as an observer receives it. */
export interface InteractionEvent {
  readonly type: InteractionType;
  /** The element's name as written in the template: `pressable`, `text`, `scroll-view`, ... */
  readonly element: string;
  /**
   * The selector of the nearest component the control is rendered inside, such as `app-button`
   * for the `<pressable>` in its template, or for one projected into its `<ng-content>`. A
   * component that is the control itself is named by `element` instead, and this is the component
   * around it. A routed page is named the same way. A component matched by an attribute is named
   * by its selector written out, such as `section[x-card]`. Absent for a control in the root
   * component's own template, and in a component with no selector, such as a page that has none.
   */
  readonly component?: string;
  /** `accessibilityLabel`, or `aria-label`. */
  readonly label?: string;
  readonly testID?: string;
  /** `nativeID`, or `id`. */
  readonly nativeID?: string;
  /** `role`, or `accessibilityRole`. */
  readonly role?: string;
  /**
   * The text inside the control, joined with spaces and cut to `MAX_TEXT_LENGTH` characters. On a
   * `click` and a `long-press`, never a `scroll` or `swipe`. It can hold what the user typed or was
   * shown, so redact it before it leaves the device.
   */
  readonly text?: string;
  /** The tag the control's own view was committed with, or null where the host has none. */
  readonly nativeTag: number | null;
  /** Where the touch landed in the window. Absent for a press that had no touch. */
  readonly pageX?: number;
  readonly pageY?: number;
  /** Where the touch landed in the control. */
  readonly locationX?: number;
  readonly locationY?: number;
  /** The control's size from its last layout, once it has had one. */
  readonly width?: number;
  readonly height?: number;
  /** Scrolls, swipes and pans only. */
  readonly direction?: InteractionDirection;
  /** The native gesture this came from, if it came from one. */
  readonly gesture?: InteractionGesture;
  /** A pan's or fling's straight-line distance from where it started, in points. */
  readonly distance?: number;
  /** A pinch's scale as it ended: above 1 spread apart, below 1 pinched together. */
  readonly scale?: number;
  /**
   * A touch, or a press with none: Android's click from a keyboard or TalkBack, or a control the
   * platform draws, such as a `<switch>`, which reports no touch point.
   */
  readonly source: 'touch' | 'click';
  /** Milliseconds since the epoch. */
  readonly timestamp: number;
}

export type InteractionObserver = (event: InteractionEvent) => void;

/** Every observer the app registered. See `provideInteractionObserver`. */
export const INTERACTION_OBSERVERS = new InjectionToken<readonly InteractionObserver[]>(
  'INTERACTION_OBSERVERS',
);

/**
 * Hear every tap, long press, scroll and swipe in the app. Can be given more than once, and every
 * observer hears every interaction, after the control's own `(press)` has run.
 *
 * ```ts
 * providers: [
 *   provideInteractionObserver((event) => {
 *     if (event.type === 'click') analytics.tap(event.label ?? event.element);
 *   }),
 * ]
 * ```
 */
export function provideInteractionObserver(observer: InteractionObserver): Provider {
  return { provide: INTERACTION_OBSERVERS, useValue: observer, multi: true };
}

/** How much of a control's text an event carries. */
export const MAX_TEXT_LENGTH = 100;

/** The observers an injector can see, or null. Read at the moment of an interaction, not before. */
export function interactionObservers(injector: Injector): readonly InteractionObserver[] | null {
  return injector.get(INTERACTION_OBSERVERS, null, { optional: true });
}

/** Observers that have thrown once already, so a broken one warns once rather than on every tap. */
const warned = new WeakSet<InteractionObserver>();

/**
 * Hand the event to each observer. One that throws is reported, and stops neither the others nor
 * the app.
 */
export function notifyInteraction(
  observers: readonly InteractionObserver[],
  event: InteractionEvent,
): void {
  for (const observer of observers) {
    try {
      observer(event);
    } catch (error) {
      if (warned.has(observer)) continue;
      warned.add(observer);
      console.warn('[ng-native] An interaction observer threw:', error);
    }
  }
}

/**
 * The parts of an event that come from the element: what it committed, so a label or role a
 * component composed onto it, or implied, is the one reported, as a screen reader hears it.
 */
export function describeElement(
  engine: HostEngine,
  node: HostNode,
): Pick<
  InteractionEvent,
  'element' | 'component' | 'label' | 'testID' | 'nativeID' | 'role' | 'nativeTag'
> {
  const props = node.props;
  const component = componentAround(node);
  const label = text(props['accessibilityLabel']);
  const testID = text(props['testID']);
  const nativeID = text(props['nativeID']);
  const role = text(props['role']) ?? text(props['accessibilityRole']);
  return {
    element: elementName(node),
    ...(component !== undefined && { component }),
    ...(label !== undefined && { label }),
    ...(testID !== undefined && { testID }),
    ...(nativeID !== undefined && { nativeID }),
    ...(role !== undefined && { role }),
    nativeTag: engine.tagOf?.(node) ?? null,
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** `tag` on the native host, `tagName` on the web host, lowercased as templates write it. */
function elementName(node: HostNode): string {
  const named = node as HostNode & { tag?: string; tagName?: string };
  return (named.tag ?? named.tagName ?? '').toLowerCase();
}

/**
 * The name of the nearest component around `node`, read at the moment of an interaction from the
 * definition the platform adapter keeps on each component's host, so nothing is kept per element.
 * A primitive, whose name is a native view's, is passed over, and so is the root component, the
 * outermost one: it is the app rather than a part of it. Told by what is marked rather than by
 * depth, since the root's host is under a surface on a device and is the page's own mount point on
 * the web. An element a package marks with no definition, to keep it a plain view, is no component.
 */
function componentAround(node: HostNode): string | undefined {
  let nearest: string | undefined;
  for (let current = node.parent; current; current = current.parent) {
    const definition = (current as EngineNode).componentHost;
    if (typeof definition !== 'object') continue;
    if (nearest !== undefined) return nearest;
    const name = componentName(definition, current);
    // A component with no selector of its own, such as a routed page, names nothing around it.
    if (name === null) return undefined;
    if (name !== undefined) nearest = name;
  }
  return undefined;
}

/** The slice of Angular's component definition a name is read from. */
interface NamedDefinition {
  /** Each selector, as Angular compiles it: the element name, then attributes and flags. */
  readonly selectors?: readonly (readonly unknown[])[];
}

/** The selector Angular gives a component that has none. */
const NO_SELECTOR = 'ng-component';

/**
 * A component's name by its selector: the element name a template writes, or for a selector of
 * attributes the selector rebuilt, such as `section[x-card]`, since its element is a plain one.
 * Of several selectors, the one its host matches, by element name, attributes and classes, or the
 * first where none does. Undefined for a primitive, whose element is a native view's, and null for
 * a component with no selector.
 */
function componentName(definition: NamedDefinition, host: HostNode): string | null | undefined {
  const selectors = definition.selectors ?? [];
  const element = elementName(host);
  const selector = selectors.find((each) => hostMatches(each, host, element)) ?? selectors[0];
  const tag = typeof selector?.[0] === 'string' ? selector[0] : '';
  if (!selector || tag === NO_SELECTOR) return null;
  if (selector.length > 1) return selectorText(selector, tag);
  return registeredViewName(tag) ? undefined : tag;
}

/** Angular's selector flags: what the parts after one are. */
const NOT = 1;
const CLASS = 8;

/**
 * Whether a host matches a compiled selector's element name, attributes and classes, up to any
 * `:not()`, which it leaves out: Angular matched the whole selector to mount the component there.
 */
function hostMatches(selector: readonly unknown[], host: HostNode, element: string): boolean {
  if (selector[0] && selector[0] !== element) return false;
  let mode = 0;
  for (let index = 1; index < selector.length; index++) {
    const part = selector[index];
    if (typeof part === 'number') {
      if (part & NOT) return true;
      mode = part;
    } else if (mode & CLASS) {
      if (!hasClass(host, String(part))) return false;
    } else if (!hasAttribute(host, String(part), selector[++index])) return false;
  }
  return true;
}

/** Whether a host has an attribute, and with `value` where it is not empty. */
function hasAttribute(host: HostNode, name: string, value: unknown): boolean {
  const actual = host.props[name];
  if (actual === undefined || actual === null || actual === false) return false;
  return !value || String(actual).toLowerCase() === String(value).toLowerCase();
}

/** Whether a host has a class: in the engine's own set, or on the web host's real element. */
function hasClass(host: HostNode, name: string): boolean {
  const classes = (host as { classes?: ReadonlySet<string> | null }).classes;
  if (classes) return classes.has(name);
  const element = (host as { el?: { classList?: { contains(name: string): boolean } } }).el;
  return element?.classList?.contains(name) ?? false;
}

/** A compiled selector written out again, up to any `:not()`. */
function selectorText(selector: readonly unknown[], tag: string): string {
  let text = tag;
  let mode = 0;
  for (let index = 1; index < selector.length; index++) {
    const part = selector[index];
    if (typeof part === 'number') {
      if (part & NOT) break;
      mode = part;
    } else if (mode & CLASS) text += `.${String(part)}`;
    else {
      const value = selector[++index];
      text += value ? `[${String(part)}=${String(value)}]` : `[${String(part)}]`;
    }
  }
  return text;
}

/** The text under a node, in order, with runs of whitespace collapsed, or undefined if none. */
export function textWithin(node: HostNode): string | undefined {
  const parts: string[] = [];
  let length = 0;
  const visit = (current: HostNode): void => {
    for (const child of current.childList) {
      if (length > MAX_TEXT_LENGTH) return;
      if (child.nodeKind === 'text') {
        const words = child.nodeText.trim();
        if (words) {
          parts.push(words);
          length += words.length + 1;
        }
      } else visit(child);
    }
  };
  visit(node);
  const text = parts.join(' ').replace(/\s+/g, ' ');
  return text ? text.slice(0, MAX_TEXT_LENGTH) : undefined;
}
