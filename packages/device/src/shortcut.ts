/**
 * Keyboard shortcuts, as `<menu-item shortcut>` and `[shortcut]` write them: `mod+s`,
 * `mod+shift+k`, `mod+,`. `mod` is Cmd on Apple's OSes and Ctrl everywhere else, so one string
 * serves every OS. The matching and the text-input rule are here, in TypeScript, so the desktop
 * host, iOS hardware keyboards and Android's key-shortcut dispatch all follow the same rules.
 */

/** The OSes a shortcut is read on, as the `OS` token names them. */
export type ShortcutOs = 'ios' | 'android' | 'macos' | 'web';

/** A key pressed with its modifiers, as a key event reports it. */
export interface KeyChord {
  /** The key, as `KeyboardEvent.key` names it: `s`, `,`, `ArrowLeft`, `[`. */
  readonly key: string;
  /** Cmd on a Mac or an iPad keyboard, the Windows or Meta key elsewhere. */
  readonly meta?: boolean;
  readonly ctrl?: boolean;
  /** Option on a Mac. */
  readonly alt?: boolean;
  readonly shift?: boolean;
}

/** A shortcut read for one OS: the key, lower case, and exactly the modifiers it needs. */
export interface ParsedShortcut {
  readonly key: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

const MODIFIERS = new Set(['mod', 'cmd', 'meta', 'ctrl', 'alt', 'option', 'shift']);

/** Whether `os` is one of Apple's, where `mod` is Cmd. */
const apple = (os: ShortcutOs): boolean => os === 'ios' || os === 'macos';

/**
 * A shortcut read for `os`. Throws on one that names no key or a modifier it does not know, since
 * that is a mistake in the app, not something a user can press.
 */
export function parseShortcut(shortcut: string, os: ShortcutOs): ParsedShortcut {
  const { key, held } = split(shortcut);
  const mod = held.has('mod');
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    meta: held.has('cmd') || held.has('meta') || (mod && apple(os)),
    ctrl: held.has('ctrl') || (mod && !apple(os)),
    alt: held.has('alt') || held.has('option'),
    shift: held.has('shift'),
  };
}

/** A shortcut's key and the modifiers it names, checked. */
function split(shortcut: string): { key: string; held: Set<string> } {
  // A trailing `+` is the plus key itself: `mod++`.
  const parts = shortcut.endsWith('++')
    ? [...shortcut.slice(0, -2).split('+'), '+']
    : shortcut.split('+');
  const key = parts.pop() ?? '';
  const held = new Set(parts.map((part) => part.trim().toLowerCase()));
  for (const modifier of held) {
    if (!MODIFIERS.has(modifier)) {
      throw new Error(`[angular-native] '${shortcut}' has no modifier '${modifier}'.`);
    }
  }
  if (!key || MODIFIERS.has(key.toLowerCase())) {
    throw new Error(`[angular-native] '${shortcut}' names no key to press.`);
  }
  return { key, held };
}

/** Whether pressing `chord` on `os` is `shortcut`: the same key, and exactly its modifiers. */
export function matchesShortcut(shortcut: string, chord: KeyChord, os: ShortcutOs): boolean {
  const wanted = parseShortcut(shortcut, os);
  const key = chord.key.length === 1 ? chord.key.toLowerCase() : chord.key;
  return (
    key === wanted.key &&
    Boolean(chord.meta) === wanted.meta &&
    Boolean(chord.ctrl) === wanted.ctrl &&
    Boolean(chord.alt) === wanted.alt &&
    Boolean(chord.shift) === wanted.shift
  );
}

/** The editing keys a focused text input owns: undo, cut, copy, paste and select all. */
const EDITING = ['mod+z', 'mod+x', 'mod+c', 'mod+v', 'mod+a'];

/** Whether `shortcut` is one of the editing keys a focused text input owns on `os`. */
export function isEditingShortcut(shortcut: string, os: ShortcutOs): boolean {
  const parsed = parseShortcut(shortcut, os);
  return EDITING.some((editing) => {
    const own = parseShortcut(editing, os);
    return (Object.keys(own) as (keyof ParsedShortcut)[]).every((k) => own[k] === parsed[k]);
  });
}

/**
 * Whether an app's `shortcut` fires for `chord`. It fires when the chord matches, except that the
 * editing keys (mod+z, x, c, v and a) go to a focused text input, so an app's shortcut on one of
 * them fires only while no text input has focus. Every other shortcut fires wherever focus is, as
 * a menu's key equivalents do.
 */
export function shortcutFires(
  shortcut: string,
  chord: KeyChord,
  os: ShortcutOs,
  textInputFocused: boolean,
): boolean {
  if (!matchesShortcut(shortcut, chord, os)) return false;
  return !(textInputFocused && isEditingShortcut(shortcut, os));
}
