import { claimHost, type Engine, type EngineNode } from '@ng-native/fabric';
import { documentOf, ownView } from './document.ts';

/**
 * `<select>`: a control that shows the option chosen and, pressed, a list of its options to
 * choose from. Native has no such view, so this draws both: the select shows only its chosen
 * `<option>`, and the list is views of the engine's own over the page, under the select.
 * Choosing sets `value` and tells `(input)` and `(change)`, as a browser does.
 *
 * The list is a light panel under a select whose text is dark, and a dark one under a select
 * whose text is light, which is how it follows a theme with no token of its own to read. Its
 * views carry the classes `select-options` and `select-option` for a stylesheet to restyle.
 *
 * ponytail: one option at a time, with no `multiple` and no keyboard. The text of an option with
 * no `value` is read as the select shows again, not as the text changes.
 */
interface Select {
  /**
   * The value last set or chosen, or nothing before either: the first option stands then. `null`
   * is none chosen, as `selectedIndex = -1` leaves it. A value no option has shows none either,
   * until an option of it comes in or options are taken out.
   */
  value: string | null | undefined;
  /** Takes the open list away, while it is open. */
  close?: () => void;
}

const selects = new WeakMap<EngineNode, Select>();

export const isSelect = (node: EngineNode): boolean => selects.has(node);

const HIDDEN = { display: 'none' };
/** A group of options has no box of its own: its options are the select's. */
const GROUP = { display: 'contents' };
const LAYER = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };
const LIST = {
  position: 'absolute',
  borderWidth: 1,
  borderRadius: 8,
  paddingVertical: 4,
  shadowColor: '#000000',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
};
const ROW = { paddingVertical: 8, paddingHorizontal: 12 };
const LABEL = { fontSize: 16 };
/** The list on a light page, and on a dark one: its panel, its border and its text. */
const LIGHT = { panel: '#ffffff', border: '#e5e5e5', text: '#0a0a0a' };
const DARK = { panel: '#262626', border: '#404040', text: '#fafafa' };
/**
 * The chosen option in the select: on the middle of its line, with no panel of its own. A flex
 * container by name, so its options are not taken for boxes in a line of text.
 */
const SELECT = { display: 'flex', justifyContent: 'center' };
const SHOWN = { backgroundColor: 'transparent' };

const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** A select's options in order, those inside an `<optgroup>` among them. */
export function optionsOf(node: EngineNode): EngineNode[] {
  return node.childList.flatMap((child) =>
    child.tag === 'option' ? [child] : child.tag === 'optgroup' ? optionsOf(child) : [],
  );
}

/** What an option reads: its text, with the whitespace a template leaves around it taken off. */
function labelOf(option: EngineNode): string {
  const text = (node: EngineNode): string =>
    node.nodeKind === 'text' ? node.nodeText : node.childList.map(text).join('');
  return text(option).trim();
}

/** An option's value: the attribute, or its text where it has none. */
const valueOfOption = (option: EngineNode): string =>
  option.props['value'] == null ? labelOf(option) : String(option.props['value']);

/**
 * The option a select shows: the one of its value, or none for a value no option has, or with
 * nothing set the last that says it is `selected`, or the first that can be chosen.
 */
export function chosen(node: EngineNode): EngineNode | undefined {
  const options = optionsOf(node);
  const value = selects.get(node)?.value;
  if (value === null) return undefined;
  if (value !== undefined) return options.find((each) => valueOfOption(each) === value);
  return (
    [...options].reverse().find((option) => on(option.props['selected'])) ??
    options.find((option) => !on(option.props['disabled'])) ??
    options[0]
  );
}

/** The select an option is in, itself or in a group of its options. */
export function selectOf(option: EngineNode): EngineNode | undefined {
  const parent = option.parent?.tag === 'optgroup' ? option.parent.parent : option.parent;
  return parent && selects.has(parent) ? parent : undefined;
}

/** `select.value`: the chosen option's value, or nothing for an element that is no select. */
export function selectValue(node: EngineNode): string | undefined {
  if (!selects.has(node)) return undefined;
  const option = chosen(node);
  return option ? valueOfOption(option) : '';
}

/** `select.selectedIndex`: where the chosen option is among the select's, or -1 with none. */
export const selectedIndex = (node: EngineNode): number =>
  selects.has(node) ? optionsOf(node).indexOf(chosen(node)!) : -1;

/** `select.selectedIndex = 2`: the option at that place is the one shown, and none past them. */
export function selectAt(node: EngineNode, index: number, engine: Engine): void {
  const select = selects.get(node);
  if (!select) return;
  const option = optionsOf(node)[index];
  select.value = option ? valueOfOption(option) : null;
  show(node, engine);
}

/**
 * The options of a select changed: none chosen chooses again, as a browser's does once options
 * come or go, and so does a value no option has once one is taken out. A value no option has yet
 * stays for one coming in, which a binding set before its options were made is.
 */
function optionsChanged(node: EngineNode, removed: boolean, engine: Engine): void {
  const select = selects.get(node);
  if (!select) return;
  const value = select.value;
  const gone =
    removed &&
    typeof value === 'string' &&
    !optionsOf(node).some((option) => valueOfOption(option) === value);
  if (value === null || gone) select.value = undefined;
  show(node, engine);
}

/** Show the chosen option in the select, and none of the others. */
function show(node: EngineNode, engine: Engine): void {
  const shown = chosen(node);
  for (const option of optionsOf(node)) {
    engine.setDefaultStyle(option, option === shown ? undefined : HIDDEN);
    // An option's own background is for the list: in the select it is the select's.
    engine.setProp(option, 'style', option === shown ? SHOWN : null);
  }
}

/** Make a `<select>` the control, and have an `<optgroup>` lay nothing out of its own. */
export function createSelect(node: EngineNode, engine: Engine): boolean {
  if (!documentOf(engine)) return false;
  if (node.tag === 'optgroup') engine.setDefaultStyle(node, GROUP);
  if (node.tag !== 'select') return false;
  selects.set(node, { value: undefined });
  // After the element's own default, which the hook that made it has already set.
  engine.setDefaultStyle(node, { ...node.defaultStyle, ...SELECT });
  engine.setProp(node, 'accessibilityRole', 'combobox');
  engine.setProp(node, 'accessible', true);
  return true;
}

/** The select each option or group was last put in, to show again once it is taken out. */
const ownedBy = new WeakMap<EngineNode, EngineNode>();

/** An option came into a select, or a group of them: what the select shows may be another. */
export function optionInserted(node: EngineNode, parent: EngineNode, engine: Engine): void {
  if (node.tag !== 'option' && node.tag !== 'optgroup') return;
  const select = parent.tag === 'optgroup' ? parent.parent : parent;
  const before = ownedBy.get(node);
  ownedBy.delete(node);
  // Moved from another select, which shows what it has left.
  if (before && before !== select) optionsChanged(before, true, engine);
  if (select && selects.has(select)) {
    ownedBy.set(node, select);
    optionsChanged(select, false, engine);
  }
}

/** An option or a group taken out of its select: the select shows what is left. */
export function optionRemoved(node: EngineNode, engine: Engine): void {
  const select = ownedBy.get(node);
  ownedBy.delete(node);
  if (select) optionsChanged(select, true, engine);
}

/** What an option says that which one is shown reads. */
const CHOOSING = new Set(['value', 'selected', 'disabled']);

/**
 * `value` set on a select: the option of that value is the one shown. True where it was one. An
 * option's `value`, `selected` or `disabled` set: its select shows again, once the option has it.
 */
export function setSelect(node: EngineNode, name: string, value: unknown, engine: Engine): boolean {
  if (node.tag === 'option' && CHOOSING.has(name)) {
    const select = selectOf(node);
    if (!select) return false;
    const state = selects.get(select)!;
    // The option chosen by its value is still the one chosen once its value changes.
    const following = name === 'value' && state.value === valueOfOption(node);
    engine.setProp(node, name, value);
    if (following) state.value = valueOfOption(node);
    show(select, engine);
    return true;
  }
  const select = selects.get(node);
  if (!select || name !== 'value') return false;
  select.value = value == null ? undefined : String(value);
  show(node, engine);
  return true;
}

/** `option.selected = true`: the option is the one its select shows. False takes it back. */
export function setSelected(option: EngineNode, selected: boolean, engine: Engine): void {
  const node = selectOf(option);
  const select = node && selects.get(node);
  if (!select) return;
  if (selected) select.value = valueOfOption(option);
  else if (chosen(node) === option) select.value = undefined;
  show(node, engine);
}

/** A form reset: the select shows what it did before anything was chosen. */
export function resetSelect(node: EngineNode, engine: Engine): void {
  const select = selects.get(node);
  if (!select) return;
  select.value = undefined;
  show(node, engine);
}

/** A press on a select: its list of options opens under it, or closes if it is open. */
export function pressSelect(node: EngineNode, engine: Engine): void {
  const select = selects.get(node);
  if (!select) return;
  if (select.close) return select.close();
  const body = documentOf(engine)!.body;
  // Over the whole page: a press anywhere outside the list closes it and reaches nothing else.
  const layer = pressable(engine, LAYER, () => select.close?.());
  const list = ownView(engine);
  engine.setClasses(list, 'select-options');
  let frame = { x: 0, y: 0, width: 0, height: 0 };
  engine.measure(node, (measured) => (frame = measured));
  // Both in the window, and the list is placed in the page: from where the page starts, which is
  // under a header, and further down under a large title.
  let page = { x: 0, y: 0 };
  engine.measure(body as unknown as EngineNode, (measured) => (page = measured));
  const place = {
    top: frame.y - page.y + frame.height + 4,
    left: frame.x - page.x,
    minWidth: frame.width,
  };
  const theme = lightText(node) ? DARK : LIGHT;
  const panel = { backgroundColor: theme.panel, borderColor: theme.border };
  engine.setProp(list, 'style', { ...LIST, ...panel, ...place });
  for (const option of optionsOf(node)) {
    row(engine, list, option, theme.text, () => {
      select.value = valueOfOption(option);
      select.close?.();
      show(node, engine);
      // As a browser tells it: `input`, then `change`, each with the select as its target.
      engine.dispatchEvent(node, 'topInput', {});
      engine.dispatchEvent(node, 'topChange', {});
    });
  }
  engine.appendChild(layer, list);
  // Through the body's own append, which is what joins it to the tree, on top of the app.
  (body as unknown as { appendChild(child: EngineNode): void }).appendChild(layer);
  select.close = () => {
    select.close = undefined;
    engine.removeChild(body, layer);
  };
}

/** One option in the open list: its text, and a press that chooses it unless it is disabled. */
function row(
  engine: Engine,
  list: EngineNode,
  option: EngineNode,
  color: string,
  choose: () => void,
): void {
  const disabled = on(option.props['disabled']);
  const view = pressable(engine, { ...ROW, opacity: disabled ? 0.5 : 1 }, () => {
    if (!disabled) choose();
  });
  engine.setClasses(view, 'select-option');
  engine.setProp(view, 'testID', `option-${valueOfOption(option)}`);
  engine.setProp(view, 'accessibilityRole', 'menuitem');
  const label = engine.createElement('text');
  // Its own, as a component's host is its component's: no template was to import it.
  claimHost(label);
  engine.setProp(label, 'style', { ...LABEL, color });
  engine.appendChild(label, engine.createText(labelOf(option)));
  engine.appendChild(view, label);
  engine.appendChild(list, view);
}

/**
 * Whether a select's text is light, which is a select on a dark page: the colour it resolved
 * to, by its channels. A colour written any other way than `rgb()` reads as dark text.
 */
function lightText(node: EngineNode): boolean {
  const color = node.styleCache?.inherited['color'] ?? node.styleCache?.style['color'];
  const channels = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(String(color ?? ''));
  if (!channels) return false;
  const [red, green, blue] = channels.slice(1).map(Number);
  // Perceived brightness, as the eye weighs the three.
  return 0.299 * red! + 0.587 * green! + 0.114 * blue! > 150;
}

/** A view of the engine's own that takes a press. */
function pressable(engine: Engine, style: object, press: () => void): EngineNode {
  const view = ownView(engine);
  engine.setProp(view, 'style', style);
  engine.setResponder(view, {
    onStartShouldSetResponder: () => true,
    onResponderRelease: press,
  });
  return view;
}
