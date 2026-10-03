/**
 * Who answers a back: Android's hardware button, and `NativeNavigation.back()`.
 *
 * Every outlet offers an answer, and the one in front takes it. Each answer is also handed to
 * `HardwareBack` directly, where React Native asks the newest first. An outlet always subscribes
 * after the outlet it sits inside, so that order runs from the innermost outlet out, and a
 * screen's own handler, subscribed after its outlet, still outranks it. `back()` asks the outlets
 * in that same order, without the screens' own handlers: those are for the button.
 *
 * Newest first is not enough on its own. A stack in a tab behind the one in front, or under a
 * screen pushed over the whole tab bar, is still subscribed, so each answer first checks that
 * its outlet is showing what the router is showing.
 */
import { Service, inject } from '@angular/core';
import type { ActivatedRoute, Router } from '@angular/router';
import { HardwareBack } from '@ng-native/device';

/** What a stack offers `NativeNavigation` beyond a back: going down it several screens at once. */
export interface PoppableStack {
  /** Whether this stack is part of what the router shows now. */
  showing(): boolean;
  /** Pop to its first screen, or null when it is showing only that one. */
  popToRoot(): Promise<boolean> | null;
  /** Pop to the screen showing `url`, or null when no screen below the top shows it. */
  popTo(url: string): Promise<boolean> | null;
}

/**
 * What a tab bar offers `NativeNavigation` for a push into one of its tabs from outside it. A tab
 * nobody has opened has no stack yet, and a page pushed into it would be the stack's first
 * screen, with nothing under it to go back to.
 */
export interface TabBar {
  /** The url of the tab `url` is a page inside, when that tab has not been opened. */
  unopenedTabOf(url: string): string | null;
  /** Whether `url` is a tab other than the one in front, or a page inside one. */
  behind(url: string): boolean;
}

@Service()
export class NativeBack {
  private readonly hardwareBack = inject(HardwareBack);
  /** Oldest first, as `HardwareBack` holds them. */
  private readonly answers: BackAnswer[] = [];
  /** Oldest first, and so outermost first, as the answers are. */
  private readonly stacks: PoppableStack[] = [];

  /** Oldest first. */
  private readonly tabBars: TabBar[] = [];

  /** Offer a tab bar's unopened tabs to a push into one. Returns an unsubscribe. */
  addTabBar(bar: TabBar): () => void {
    this.tabBars.push(bar);
    return () => {
      const index = this.tabBars.indexOf(bar);
      if (index !== -1) this.tabBars.splice(index, 1);
    };
  }

  /** The url of the unopened tab `url` is a page inside, or null: see `TabBar`. */
  unopenedTabOf(url: string): string | null {
    for (const bar of this.tabBars) {
      const root = bar.unopenedTabOf(url);
      if (root) return root;
    }
    return null;
  }

  /** Whether `url` belongs to a tab that is not the one in front. */
  inTabBehind(url: string): boolean {
    return this.tabBars.some((bar) => bar.behind(url));
  }

  /**
   * Whether the app's own stack takes a page presented over whatever is showing. Set by the root
   * stack outlet for as long as there is one: see `presented-route.ts`.
   */
  presents = false;

  /** Offer a stack for popping several screens at once. Returns an unsubscribe. */
  addStack(stack: PoppableStack): () => void {
    this.stacks.push(stack);
    return () => {
      const index = this.stacks.indexOf(stack);
      if (index !== -1) this.stacks.splice(index, 1);
    };
  }

  /** Pop the innermost stack in front that is deeper than one screen, to its first. */
  popToRoot(): Promise<boolean> {
    for (const stack of [...this.stacks].reverse()) {
      if (!stack.showing()) continue;
      const popped = stack.popToRoot();
      if (popped) return popped;
    }
    return Promise.resolve(false);
  }

  /** Pop the innermost stack in front that has a screen at `url` below its top, down to it. */
  popTo(url: string): Promise<boolean> {
    for (const stack of [...this.stacks].reverse()) {
      if (!stack.showing()) continue;
      const popped = stack.popTo(url);
      if (popped) return popped;
    }
    return Promise.resolve(false);
  }

  /**
   * Offer an outlet's answer to a back. It returns whether it took the back, and false lets the
   * next one out try. Returns an unsubscribe.
   */
  handle(answer: BackAnswer): () => void {
    this.answers.push(answer);
    const stop = this.hardwareBack.handle(() => answer('button'));
    return () => {
      stop();
      const index = this.answers.indexOf(answer);
      if (index !== -1) this.answers.splice(index, 1);
    };
  }

  /** Go back as the button would, innermost outlet first. False when none had anywhere to go. */
  back(): boolean {
    return [...this.answers].reverse().some((answer) => answer('app'));
  }
}

/**
 * An outlet's answer to a back, told where it came from: Android's button, which is the platform's
 * own dismissal and a screen may refuse, or the app's `NativeNavigation.back()`, which it may not.
 */
export type BackAnswer = (from: 'button' | 'app') => boolean;

/**
 * Whether a route is part of what the router shows now, rather than a subtree the reuse strategy
 * detached and is keeping for later: a tab behind, or a screen covered by one pushed over it.
 */
export function isShowing(router: Router, route: ActivatedRoute | null): boolean {
  if (!route) return false;
  const visit = (node: ActivatedRoute): boolean => node === route || node.children.some(visit);
  return visit(router.routerState.root);
}
