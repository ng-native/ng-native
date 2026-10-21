/**
 * Binds a style holding animated values to the element it sits on: the Angular equivalent of
 * React Native's `createAnimatedComponent`.
 *
 * ```html
 * <view [animatedStyle]="{ opacity: fade, transform: [{ translateY: slide }] }">
 * ```
 *
 * Two drivers, and the difference is where the work happens. With `useNativeDriver: true` the
 * whole animation runs on the UI thread: this hands the graph the element's react tag once and
 * then does nothing per frame, so the animation keeps its frame rate with the JavaScript thread
 * blocked. Without it, every frame calls back here and is written to the node. A browser has only
 * the second kind: `animations-web.ts` supplies a graph that is JavaScript-driven throughout, and
 * `useNativeDriver` there changes nothing.
 *
 * A JavaScript frame commits outside change detection, one of the two exceptions to committing at
 * most once per change-detection pass (the other is a CSS transition). It has to: the graph advances on its own schedule, and waiting for the next change
 * detection pass would drop the frame. The commit is incremental like any other, and touches
 * only the nodes the frame changed.
 */
import {
  Directive,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Engine, HostEngine, type EngineNode, type HostNode } from '@ng-native/fabric';
import { ANIMATION, type AnimatedPropsHandle } from './animation.ts';

/**
 * The behaviour, with the graph left as a dependency so it can be driven by a fake. `AnimatedStyle`
 * in `../animations.ts` is the one apps import: same selector, and it supplies the real graph
 * itself - React Native's on a device, `animated.ts` in a browser - so importing the directive is
 * the whole setup.
 */
@Directive({ selector: '[animatedStyle]' })
export class AnimatedStyleBase {
  private readonly node = inject(ElementRef).nativeElement as HostNode;
  // The shared host seam, read off the node as every primitive reads it, so a browser host serves
  // this as well as Fabric does. Only the react tag is Fabric's own, and `connect()` asks for it.
  private readonly engine = this.node.engine ?? inject(HostEngine);
  private readonly animation = inject(ANIMATION);

  /** A style object whose values may be animated nodes, plain numbers, or a mix. */
  readonly animatedStyle = input.required<Record<string, unknown>>();

  private handle: AnimatedPropsHandle | null = null;
  private connected = false;

  constructor() {
    // A node has a react tag only once it has been committed, and a native-driven animation
    // never calls back into JavaScript, so there would otherwise be no moment to hand it over.
    afterNextRender(() => this.connect());

    effect((onCleanup) => {
      const style = this.animatedStyle();
      const handle = this.animation.props(style, () => untracked(() => this.frame()));
      this.handle = handle;
      this.connected = false;
      handle.attach();
      // The starting values, so the element is right before anything animates. This runs inside
      // change detection, so the commit it needs is the ordinary one.
      this.write(handle.read());

      onCleanup(() => {
        handle.detach();
        if (this.handle === handle) this.handle = null;
      });
    });
  }

  /**
   * One JavaScript-driven frame. Also the first chance to hand over the react tag: a node has
   * one only after it has been committed, and this runs after at least one commit has happened.
   */
  private frame(): void {
    const handle = this.handle;
    if (!handle) return;
    this.write(handle.read());
    this.engine.commit();
  }

  private write(values: Record<string, unknown>): void {
    const current = (this.node.props['style'] as Record<string, unknown> | undefined) ?? {};
    this.engine.setProp(this.node, 'style', { ...current, ...values });
    this.connect();
  }

  /**
   * Hand the graph the react tag, once there is one. Calling this before an animation starts is
   * the point: React Native connects the view now if the graph is already native, and remembers
   * it for the moment an animation with the native driver takes over.
   */
  private connect(): void {
    if (this.connected) return;
    // A browser has no native driver to hand a view to, so there is no tag to look for.
    if (!(this.engine instanceof Engine)) return;
    const tag = this.engine.tagOf(this.node as EngineNode);
    if (tag === null) return;
    this.handle?.connect(tag);
    this.connected = true;
  }
}
