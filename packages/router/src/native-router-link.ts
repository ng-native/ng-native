/**
 * `routerLink` for native.
 *
 * Angular's `RouterLink` host-binds `href` and listens for a DOM click, neither of which exists
 * here. This binds to a `<pressable>`'s `press` output instead.
 *
 * Because Angular resolves outputs across every directive on an element, the host listener below
 * binds to `Pressable`'s `press` output without importing it, so the router package does not
 * depend on the components package.
 */
import { Directive, booleanAttribute, inject, input } from '@angular/core';
import { ActivatedRoute, Router, type NavigationExtras } from '@angular/router';
import { NATIVE_INTENT } from './native-navigation.ts';
import { leavingPresented } from './presented-route.ts';

@Directive({
  selector: '[nativeRouterLink]',
  host: { '(press)': 'navigate()' },
})
export class NativeRouterLink {
  /** A url string, or the command array `Router.navigate` takes. */
  readonly nativeRouterLink = input.required<string | readonly unknown[]>();
  readonly extras = input<NavigationExtras>();

  /** Replace the current screen rather than pushing a new one. */
  readonly replace = input(false, { transform: booleanAttribute });

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });

  protected navigate(): void {
    const target = this.nativeRouterLink();
    const own = this.extras();
    const extras: NavigationExtras = {
      relativeTo: this.route,
      replaceUrl: this.replace(),
      ...own,
    };
    // The stack reads the intent, as `NativeNavigation` sets it. `replaceUrl` only swaps the
    // history entry: without `replace` the replaced screen stays mounted underneath, and a swipe
    // back lands on a page the history no longer has. So the intent follows `replaceUrl` as the
    // navigation has it, `[extras]` included, not the `replace` input alone. Without `push` a
    // link to a url already on the stack goes back to that screen rather than putting a new one
    // over it.
    const stack = extras.replaceUrl ? 'replace' : 'push';
    extras.state = { ...own?.state, [NATIVE_INTENT]: { stack } };

    const commands = Array.isArray(target) ? [...target] : [target];
    const leaving = leavingPresented(this.router, commands, extras);
    void (leaving
      ? this.router.navigateByUrl(leaving, extras)
      : this.router.navigate(commands, extras));
  }
}
