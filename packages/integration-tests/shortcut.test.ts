/**
 * Shortcut matching and the text-input rule, which every OS shares: `mod` is Cmd on Apple's OSes
 * and Ctrl elsewhere, a chord matches only with exactly the shortcut's modifiers, and the editing
 * keys go to a focused text input before an app's shortcut.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isEditingShortcut,
  matchesShortcut,
  parseShortcut,
  shortcutFires,
} from '@ng-native/device';

describe('a shortcut', () => {
  it('reads mod as Cmd on Apple OSes and Ctrl elsewhere', () => {
    for (const os of ['ios', 'macos'] as const) {
      assert.deepEqual(parseShortcut('mod+s', os), {
        key: 's',
        meta: true,
        ctrl: false,
        alt: false,
        shift: false,
      });
    }
    for (const os of ['android', 'web'] as const) {
      assert.deepEqual(parseShortcut('mod+s', os), {
        key: 's',
        meta: false,
        ctrl: true,
        alt: false,
        shift: false,
      });
    }
  });

  it('reads named modifiers, the plus key and a key name', () => {
    assert.deepEqual(parseShortcut('ctrl+mod+f', 'macos'), {
      key: 'f',
      meta: true,
      ctrl: true,
      alt: false,
      shift: false,
    });
    assert.deepEqual(parseShortcut('option+shift+K', 'macos'), {
      key: 'k',
      meta: false,
      ctrl: false,
      alt: true,
      shift: true,
    });
    assert.equal(parseShortcut('mod++', 'macos').key, '+');
    assert.equal(parseShortcut('alt+ArrowLeft', 'android').key, 'ArrowLeft');
  });

  it('throws on a shortcut that names no key, or a modifier it does not know', () => {
    assert.throws(() => parseShortcut('mod+shift', 'macos'), /names no key/);
    assert.throws(() => parseShortcut('', 'macos'), /names no key/);
    assert.throws(() => parseShortcut('hyper+k', 'macos'), /no modifier 'hyper'/);
  });

  it('matches a chord with exactly its modifiers, whatever case the key comes in', () => {
    assert.equal(matchesShortcut('mod+s', { key: 's', meta: true }, 'macos'), true);
    assert.equal(matchesShortcut('mod+s', { key: 's', ctrl: true }, 'macos'), false);
    assert.equal(matchesShortcut('mod+s', { key: 's', ctrl: true }, 'android'), true);
    assert.equal(matchesShortcut('mod+s', { key: 's', meta: true, shift: true }, 'macos'), false);
    assert.equal(
      matchesShortcut('mod+shift+k', { key: 'K', meta: true, shift: true }, 'ios'),
      true,
    );
    assert.equal(matchesShortcut('mod+s', { key: 'd', meta: true }, 'macos'), false);
  });
});

describe('the text-input rule', () => {
  it('names undo, cut, copy, paste and select all as the editing keys', () => {
    for (const key of ['z', 'x', 'c', 'v', 'a']) {
      assert.equal(isEditingShortcut(`mod+${key}`, 'macos'), true, key);
      assert.equal(isEditingShortcut(`ctrl+${key}`, 'android'), true, `ctrl+${key} on Android`);
    }
    assert.equal(isEditingShortcut('mod+shift+z', 'macos'), false);
    assert.equal(isEditingShortcut('mod+s', 'macos'), false);
    assert.equal(isEditingShortcut('ctrl+c', 'macos'), false, 'Ctrl-C is not copy on a Mac');
  });

  it('gives the editing keys to a focused text input, and fires the app shortcut otherwise', () => {
    const copy = { key: 'c', meta: true };
    assert.equal(shortcutFires('mod+c', copy, 'macos', true), false);
    assert.equal(shortcutFires('mod+c', copy, 'macos', false), true);
    assert.equal(shortcutFires('mod+c', copy, 'ios', true), false, 'an iPad keyboard too');
  });

  it('fires any other shortcut wherever focus is', () => {
    assert.equal(shortcutFires('mod+s', { key: 's', meta: true }, 'macos', true), true);
    assert.equal(shortcutFires('mod+s', { key: 'd', meta: true }, 'macos', false), false);
  });
});
