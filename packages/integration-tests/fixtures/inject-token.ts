import { Component, ElementRef, inject, signal } from '@angular/core';
import { injectToken } from '../../device/src/inject-token.ts';
import { Text } from '../../components/src/text.ts';

/** A token read where a class lower in the tree sets it again. */
@Component({
  selector: 'x-scoped-token',
  imports: [Text],
  host: { class: 'local' },
  template: `<text testID="scoped">{{ accent() ?? 'none' }}</text>`,
})
export class ScopedToken {
  protected readonly accent = injectToken('--accent', {
    at: inject(ElementRef).nativeElement,
  });
}

/** Tokens read from TypeScript, at the root and at a node, as a prop that takes a colour is given. */
@Component({
  selector: 'x-inject-token',
  imports: [Text, ScopedToken],
  template: `
    <text testID="root">{{ accent() ?? 'none' }}</text>
    <text testID="missing">{{ missing() ?? 'none' }}</text>
    @if (scoped()) {
      <x-scoped-token />
    }
  `,
})
export class InjectToken {
  protected readonly accent = injectToken('--accent');
  protected readonly missing = injectToken('--nowhere');
  readonly scoped = signal(true);
}
