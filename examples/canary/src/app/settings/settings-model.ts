import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { ColorScheme } from '@ng-native/device';
import { Storage } from '@ng-native/expo/async-storage';

export type Appearance = 'light' | 'dark' | 'automatic';

/** One row of the list: where it goes, or the switch it is. */
export interface SettingRow {
  readonly id: string;
  readonly title: string;
  /** An ng-icons name, drawn white on the tile. */
  readonly icon: string;
  /** The tile's colour, bound as a CSS variable its gradient derives from. */
  readonly tint: string;
  /** A detail page, by its path under settings, or a switch by the state it flips. */
  readonly to?: string;
  readonly toggle?: 'airplane';
  /** Words beyond the title a search finds it by. */
  readonly keywords?: string;
}

export const GROUPS: readonly (readonly SettingRow[])[] = [
  [
    {
      id: 'airplane',
      title: 'Airplane Mode',
      icon: 'lucidePlane',
      tint: '#ff9500',
      toggle: 'airplane',
    },
    {
      id: 'wifi',
      title: 'Wi-Fi',
      icon: 'lucideWifi',
      tint: '#007aff',
      to: 'wifi',
      keywords: 'network internet',
    },
    {
      id: 'bluetooth',
      title: 'Bluetooth',
      icon: 'lucideBluetooth',
      tint: '#007aff',
      to: 'bluetooth',
    },
    { id: 'battery', title: 'Battery', icon: 'lucideBatteryFull', tint: '#34c759', to: 'battery' },
  ],
  [
    {
      id: 'notifications',
      title: 'Notifications',
      icon: 'lucideBell',
      tint: '#ff3b30',
      to: 'notifications',
    },
    {
      id: 'sounds',
      title: 'Sounds & Haptics',
      icon: 'lucideVolume2',
      tint: '#ff2d55',
      to: 'sounds',
    },
    {
      id: 'focus',
      title: 'Focus',
      icon: 'lucideMoon',
      tint: '#5856d6',
      to: 'focus',
      keywords: 'do not disturb',
    },
  ],
  [
    {
      id: 'general',
      title: 'General',
      icon: 'lucideSettings',
      tint: '#8e8e93',
      to: 'general',
      keywords: 'about version',
    },
    {
      id: 'accessibility',
      title: 'Accessibility',
      icon: 'lucideAccessibility',
      tint: '#0a84ff',
      to: 'accessibility',
    },
    {
      id: 'display',
      title: 'Display & Brightness',
      icon: 'lucideSun',
      tint: '#0a84ff',
      to: 'display',
      keywords: 'dark mode appearance text size bold',
    },
  ],
  [
    {
      id: 'privacy',
      title: 'Privacy & Security',
      icon: 'lucideHand',
      tint: '#0a84ff',
      to: 'privacy',
    },
    {
      id: 'passcode',
      title: 'Face ID & Passcode',
      icon: 'lucideLock',
      tint: '#34c759',
      to: 'passcode',
    },
  ],
];

export const ROWS = GROUPS.flat();

export interface Network {
  readonly name: string;
  readonly strength: 1 | 2 | 3;
  readonly secured: boolean;
}

export const NETWORKS: readonly Network[] = [
  { name: 'Morgan Home', strength: 3, secured: true },
  { name: 'BT-Hub-7F2A', strength: 2, secured: true },
  { name: 'Cafe Nero Guest', strength: 2, secured: false },
  { name: 'SKY9C1D0', strength: 1, secured: true },
];

/** The rows a search finds: every word of it in the title or the keywords. */
export function search(query: string): SettingRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ROWS.filter((row) => {
    const text = `${row.title} ${row.keywords ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** What the settings are set to. Held for the session; the canary does not persist them. */
@Service()
export class Settings {
  private readonly scheme = inject(ColorScheme);
  private readonly store = inject(Storage);
  readonly airplane = signal(false);
  readonly wifi = signal(true);
  readonly network = signal<string | null>('Morgan Home');
  readonly bluetooth = signal(true);
  /**
   * Kept across launches and applied once it is read back: iOS starts each launch in the system's
   * scheme, and Android 12 and later in the one last set, so neither can say what was chosen.
   */
  readonly appearance = this.store.signal<Appearance>('appearance', 'automatic');
  readonly textSize = signal(3);
  readonly bold = signal(false);
  readonly previews = signal<'always' | 'unlocked' | 'never'>('unlocked');

  /** What a row says on its right, if anything. */
  readonly values = computed<Record<string, string>>(() => ({
    wifi: this.airplane() || !this.wifi() ? 'Off' : (this.network() ?? 'Not Connected'),
    bluetooth: this.bluetooth() ? 'On' : 'Off',
    display:
      this.appearance() === 'automatic'
        ? 'Automatic'
        : this.appearance() === 'dark'
          ? 'Dark'
          : 'Light',
  }));

  constructor() {
    effect(() => {
      if (!this.store.ready()) return;
      const appearance = this.appearance();
      untracked(() => this.scheme.set(appearance === 'automatic' ? null : appearance));
    });
  }

  setAppearance(appearance: Appearance): void {
    this.appearance.set(appearance);
  }
}
