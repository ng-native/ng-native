import { DestroyRef, Directive, inject, input, output, type OnInit } from '@angular/core';
import { Menus } from '@ng-native/device';

/**
 * A keyboard shortcut anywhere in the app, while the element is there: `shortcut="mod+k"` fires
 * `(shortcutPress)`. `mod` is Cmd on Apple's OSes and Ctrl on Android. On iPhone and Android it
 * works from a hardware keyboard, and Android lists it in the Keyboard Shortcuts helper under
 * `shortcutLabel`. The editing keys (mod+z, x, c, v and a) go to a focused text input first.
 */
@Directive({ selector: '[shortcut]:not(menu-item)' })
export class Shortcut implements OnInit {
  readonly shortcut = input.required<string>();
  /** What Android's Keyboard Shortcuts helper lists it as. */
  readonly shortcutLabel = input('');
  readonly shortcutPress = output<void>();

  private readonly menus = inject(Menus);
  private readonly destroyRef = inject(DestroyRef);

  /** Once the inputs are set: a bound `[shortcut]` has no value while the constructor runs. */
  ngOnInit(): void {
    this.register();
  }

  private register(): void {
    const stop = this.menus.addShortcut(this.shortcut, this.shortcutLabel, () =>
      this.shortcutPress.emit(),
    );
    this.destroyRef.onDestroy(stop);
  }
}
