/**
 * Testing Library's queries, over the tree the renderer committed to the fake Fabric.
 *
 * There is no DOM here, so `@testing-library/dom` has nothing to query: a query reads the props a
 * native view would actually receive. That makes the names mean what React Native Testing Library
 * means by them rather than what the web does - a role is `accessibilityRole`, a label is
 * `accessibilityLabel`, text is what a `Paragraph` holds.
 *
 * Every query re-reads the most recent commit. The fake builds a fresh node object per commit, so
 * a node held across an interaction is a snapshot of the frame it was found in; query again to see
 * what changed.
 */
import { isTextInputView } from '@ng-native/fabric';
import type { FakeFabricNode } from './test-utils.ts';
import { waitFor, type WaitForOptions } from './wait-for.ts';
import { expoUiButtonDisabled, expoUiButtonName, isExpoUiButton } from './expo-ui-button.ts';

/** What a query matches against: a whole string (normalised), or a RegExp tested against it. */
export type Matcher = string | RegExp;

/** How a string `Matcher` compares. */
export interface TextMatchOptions {
  /** `false` matches a case-insensitive substring instead of the whole, trimmed string. */
  exact?: boolean;
  /**
   * Also find what nobody could see or reach: views under `display: none`, and those hidden from
   * accessibility. React Native Testing Library's option, and its default of `false`.
   */
  includeHiddenElements?: boolean;
}

/**
 * `ByRole`'s options: a role alone matches every node with it, `name` narrows it to one, and a
 * state narrows it to the nodes in that state, as React Native Testing Library's do.
 */
export interface ByRoleOptions extends TextMatchOptions {
  /** The accessible name: `accessibilityLabel`, or failing that the text inside the node. */
  name?: Matcher;
  /** Disabled, from `accessibilityState` or `aria-disabled`; a field that is not editable is. */
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  busy?: boolean;
  expanded?: boolean;
}

/** The states `ByRole` filters on. */
const STATES = ['disabled', 'selected', 'checked', 'busy', 'expanded'] as const;
type State = (typeof STATES)[number];

/** The roles React Native Testing Library reads `checked` for; any other has none. */
const CHECKABLE: ReadonlySet<unknown> = new Set(['checkbox', 'radio', 'switch']);

/** What a state is when nothing set it: off, or for `checked` and `expanded`, not had at all. */
const UNSET: Readonly<Record<State, false | undefined>> = {
  disabled: false,
  selected: false,
  checked: undefined,
  busy: false,
  expanded: undefined,
};

/** Whether a node can have the state at all: `checked` only on a checkbox, radio or switch. */
const has = (node: FakeFabricNode, state: State): boolean =>
  state !== 'checked' || CHECKABLE.has(node.props['accessibilityRole'] ?? node.props['role']);

/**
 * The roles a query finds the node by: `accessibilityRole` and `role`. `@expo/ui`'s button is a
 * button, and its `role` is SwiftUI's, which says what the button does (`destructive`).
 */
const rolesOf = (node: FakeFabricNode): unknown[] =>
  isExpoUiButton(node)
    ? [node.props['accessibilityRole'] ?? 'button']
    : [node.props['accessibilityRole'], node.props['role']];

/**
 * A state as a screen reader has it: what the committed `accessibilityState` says, which the
 * components and the `aria-*` attributes write. Unset is false for the states that are off until
 * something says otherwise, and stays unset for `checked` and `expanded`, which a node only has
 * when it can be checked or expanded; `checked` only counts on a checkbox, radio or switch. React
 * Native Testing Library's rules.
 */
function stateOf(node: FakeFabricNode, state: State): boolean | 'mixed' | undefined {
  if (state === 'disabled' && isTextInput(node) && node.props['editable'] === false) return true;
  if (state === 'disabled' && isExpoUiButton(node) && expoUiButtonDisabled(node)) return true;
  if (!has(node, state)) return undefined;
  const value = (node.props['accessibilityState'] as Record<string, unknown> | undefined)?.[state];
  return value === true || value === false || value === 'mixed' ? value : UNSET[state];
}

/** Whether a node is in every state the options ask for. */
const inStates = (node: FakeFabricNode, options: ByRoleOptions): boolean =>
  STATES.every((state) => options[state] === undefined || stateOf(node, state) === options[state]);

/** The states the options ask for, for an error message. */
const describeStates = (options: ByRoleOptions): string =>
  STATES.filter((state) => options[state] !== undefined)
    .map((state) => ` and ${state} ${String(options[state])}`)
    .join('');

interface QueryArgs {
  Role: [role: Matcher, options?: ByRoleOptions];
  Text: [text: Matcher, options?: TextMatchOptions];
  TestId: [testId: Matcher, options?: TextMatchOptions];
  LabelText: [label: Matcher, options?: TextMatchOptions];
  PlaceholderText: [placeholder: Matcher, options?: TextMatchOptions];
  DisplayValue: [value: Matcher, options?: TextMatchOptions];
}

type Name = keyof QueryArgs;
type FindArgs<K extends Name> = [...QueryArgs[K], waitForOptions?: WaitForOptions];

/**
 * The query matrix: `getBy`, `getAllBy`, `queryBy`, `queryAllBy`, `findBy` and `findAllBy`, for
 * each of `Role`, `Text`, `TestId`, `LabelText`, `PlaceholderText` and `DisplayValue`.
 */
export type BoundQueries = {
  [K in Name as `getBy${K}`]: (...args: QueryArgs[K]) => FakeFabricNode;
} & {
  [K in Name as `getAllBy${K}`]: (...args: QueryArgs[K]) => FakeFabricNode[];
} & {
  [K in Name as `queryBy${K}`]: (...args: QueryArgs[K]) => FakeFabricNode | null;
} & {
  [K in Name as `queryAllBy${K}`]: (...args: QueryArgs[K]) => FakeFabricNode[];
} & {
  [K in Name as `findBy${K}`]: (...args: FindArgs<K>) => Promise<FakeFabricNode>;
} & {
  [K in Name as `findAllBy${K}`]: (...args: FindArgs<K>) => Promise<FakeFabricNode[]>;
};

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

function matches(value: unknown, matcher: Matcher, exact = true): boolean {
  if (typeof value !== 'string') return false;
  const text = normalize(value);
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(text);
  }
  const wanted = normalize(matcher);
  return exact ? text === wanted : text.toLowerCase().includes(wanted.toLowerCase());
}

const show = (matcher: Matcher): string =>
  matcher instanceof RegExp ? String(matcher) : JSON.stringify(matcher);

export const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/**
 * `nodes` with each node's `parent` set through the tree beneath, so a test can go up from what a
 * query found: the row a text is in. Not enumerable, so a node compares and prints as it did.
 */
export function withParents(
  nodes: readonly FakeFabricNode[],
  parent?: FakeFabricNode,
): readonly FakeFabricNode[] {
  for (const node of nodes) {
    // The nodes a walk starts from keep the parent they have: `within(row)` starts from the row.
    if (parent || !('parent' in node)) {
      const value = parent ?? null;
      Object.defineProperty(node, 'parent', { value, configurable: true, writable: true });
    }
    withParents(node.children, node);
  }
  return nodes;
}

/**
 * A view that takes itself and everything under it out of sight or out of the accessibility tree,
 * as React Native Testing Library's `isHiddenFromAccessibility` decides it. And one with no
 * opacity that takes no touch, which nobody can see or reach: a row a list keeps to use again.
 * An element that is `display: none` has no view to ask about.
 */
function hides(node: FakeFabricNode): boolean {
  const props = node.props;
  return (
    (props['opacity'] === 0 && props['pointerEvents'] === 'none') ||
    props['accessibilityElementsHidden'] === true ||
    props['aria-hidden'] === true ||
    props['importantForAccessibility'] === 'no-hide-descendants'
  );
}

/** Every node someone using the app could see or reach. */
const reachable = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => (hides(node) ? [] : [node, ...reachable(node.children)]));

/** What a screen reader would read out: every `RawText` under the node, in order. */
export function textContent(node: FakeFabricNode): string {
  if (node.viewName === 'RawText') return String(node.props['text'] ?? '');
  return node.children.map(textContent).join('');
}

/** A text field under either of the names the platforms commit it by. */
export const isTextInput = (node: FakeFabricNode): boolean => isTextInputView(node.viewName);

/** The navigation bar's search field, which reports text as `topChangeText` with no count. */
export const isSearchBar = (node: FakeFabricNode): boolean => node.viewName === 'RNSSearchBar';

type Query = { describe: string; select: (node: FakeFabricNode) => boolean };

/** What a screen reader reads out: the label, or failing that the text inside. */
const nameOf = (node: FakeFabricNode): string => {
  if (typeof node.props['accessibilityLabel'] === 'string') return node.props['accessibilityLabel'];
  return isExpoUiButton(node) ? expoUiButtonName(node) : textContent(node);
};

const QUERIES: { [K in Name]: (...args: QueryArgs[K]) => Query } = {
  Role: (role, options = {}) => ({
    describe:
      `role ${show(role)}` +
      (options.name === undefined ? '' : ` and name ${show(options.name)}`) +
      describeStates(options),
    select: (node) =>
      rolesOf(node).some((value) => matches(value, role)) &&
      (options.name === undefined || matches(nameOf(node), options.name, options.exact)) &&
      inStates(node, options),
  }),
  // `Paragraph` alone: a nested `<text>` commits as a `Text` span inside one, so the paragraph is
  // the whole run of text and the span is only a part of it.
  Text: (text, options = {}) => ({
    describe: `text ${show(text)}`,
    select: (node) =>
      node.viewName === 'Paragraph' && matches(textContent(node), text, options.exact),
  }),
  // Both, because the components commit both: `testID` from `testID`, `nativeID` from `nativeID`
  // or its web spelling `id`, which is what most templates in this project reach for.
  TestId: (testId, options = {}) => ({
    describe: `testID ${show(testId)}`,
    select: (node) =>
      matches(node.props['testID'], testId, options.exact) ||
      matches(node.props['nativeID'], testId, options.exact),
  }),
  LabelText: (label, options = {}) => ({
    describe: `accessibilityLabel ${show(label)}`,
    select: (node) => matches(node.props['accessibilityLabel'], label, options.exact),
  }),
  PlaceholderText: (placeholder, options = {}) => ({
    describe: `placeholder ${show(placeholder)}`,
    // A text field and the navigation bar's search field draw a placeholder. A wrapper with a
    // `placeholder` input of its own has the attribute on its host view too, which nobody sees.
    select: (node) =>
      (isTextInput(node) || isSearchBar(node)) &&
      matches(node.props['placeholder'], placeholder, options.exact),
  }),
  // A text field's value is its `text` prop, which is what `<text-input>` binds its model to.
  DisplayValue: (value, options = {}) => ({
    describe: `display value ${show(value)}`,
    select: (node) => isTextInput(node) && matches(node.props['text'], value, options.exact),
  }),
};

/**
 * Every query, bound to a root that is looked up again on each call.
 *
 * `found` sees every node a query hands back, so an event fired on one later knows which render
 * it came from.
 */
export function bindQueries(
  roots: () => readonly FakeFabricNode[],
  tree: () => string,
  found: (node: FakeFabricNode) => void,
): BoundQueries {
  const bound: Record<string, unknown> = {};

  for (const name of Object.keys(QUERIES) as Name[]) {
    const all = (...args: unknown[]): FakeFabricNode[] => {
      const query = (QUERIES[name] as (...a: unknown[]) => Query)(...args);
      const options = args[1] as TextMatchOptions | undefined;
      const walk = options?.includeHiddenElements ? flatten : reachable;
      const hits = walk(withParents(roots())).filter(query.select);
      hits.forEach(found);
      return hits;
    };
    const describe = (args: unknown[]): string =>
      (QUERIES[name] as (...a: unknown[]) => Query)(...args).describe;
    const one = (...args: unknown[]): FakeFabricNode => {
      const hits = all(...args);
      if (hits.length === 1) return hits[0]!;
      const problem = hits.length
        ? `Found ${hits.length} nodes with ${describe(args)}, and expected one. Use getAllBy${name} if more than one is expected.`
        : `Unable to find a node with ${describe(args)}.`;
      throw new Error(`${problem}\n\n${tree()}`);
    };
    // The last argument of a `findBy` is the `waitFor` options, and it is only ever that when the
    // query itself was given its options too.
    const split = (args: unknown[]): [unknown[], WaitForOptions | undefined] =>
      args.length > 2 ? [args.slice(0, 2), args[2] as WaitForOptions] : [args, undefined];

    bound[`getAllBy${name}`] = (...args: unknown[]) => {
      const hits = all(...args);
      if (!hits.length)
        throw new Error(`Unable to find a node with ${describe(args)}.\n\n${tree()}`);
      return hits;
    };
    bound[`queryAllBy${name}`] = all;
    bound[`getBy${name}`] = one;
    bound[`queryBy${name}`] = (...args: unknown[]) => {
      const hits = all(...args);
      if (hits.length > 1) return one(...args);
      return hits[0] ?? null;
    };
    bound[`findBy${name}`] = (...args: unknown[]) => {
      const [query, options] = split(args);
      return waitFor(() => one(...query), options);
    };
    bound[`findAllBy${name}`] = (...args: unknown[]) => {
      const [query, options] = split(args);
      return waitFor(() => (bound[`getAllBy${name}`] as typeof all)(...query), options);
    };
  }

  return bound as BoundQueries;
}

/** The debug tree: view names, text, and the props a query can find a node by. */
export function describeTree(nodes: readonly FakeFabricNode[], depth = 0): string {
  return nodes
    .map((node) => {
      const text = node.viewName === 'RawText' ? ` ${JSON.stringify(node.props['text'])}` : '';
      const props = IDENTIFYING.filter((key) => node.props[key] != null && node.props[key] !== '')
        .map((key) => ` ${key === 'text' ? 'value' : key}=${JSON.stringify(node.props[key])}`)
        .join('');
      const line = '  '.repeat(depth) + node.viewName + text + (text ? '' : props);
      return node.children.length ? `${line}\n${describeTree(node.children, depth + 1)}` : line;
    })
    .join('\n');
}

const IDENTIFYING = [
  'testID',
  'nativeID',
  'accessibilityRole',
  'role',
  'accessibilityLabel',
  'placeholder',
  'text',
];
