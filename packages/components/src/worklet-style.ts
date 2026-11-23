/**
 * A style computed on the UI thread, by a Reanimated worklet.
 *
 * The difference from `AnimatedStyle` is where the work happens. An animated style advances in
 * JavaScript unless the native driver can take the whole animation over, and the native driver
 * only understands the animations React Native itself can express. A worklet is arbitrary code
 * running on a second JavaScript runtime that lives on the UI thread, so anything computable per
 * frame - a gesture following a finger, a value derived from three others - keeps its frame rate
 * with the JavaScript thread busy.
 *
 * `WorkletStyle` in `../reanimated.ts` is the one apps import: same selector, and it supplies the
 * real runtime itself.
 */
import {
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
} from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { WORKLETS, type WorkletStyleSpec } from './worklets.ts';

/** The behaviour, with the runtime left as a dependency so a test can drive a fake one. */
@Directive({ selector: '[workletStyle]' })
export class WorkletStyleBase {
  private readonly node = inject(ElementRef).nativeElement as EngineNode;
  private readonly engine = inject(Engine);
  private readonly worklets = inject(WORKLETS);
  private readonly injector = inject(Injector);

  readonly workletStyle = input.required<WorkletStyleSpec>();

  /**
   * What the UI thread has drawn the node with and let go of, from every style bound so far: a
   * replaced style leaves what the one before drew, as Reanimated leaves it on the view.
   */
  private drawn: Readonly<Record<string, unknown>> = {};

  constructor() {
    // A node has neither a react tag nor a shadow node until it has been committed once, and
    // there is nothing for the UI thread to write to before then.
    afterNextRender(() => {
      effect(
        (onCleanup) => {
          const style = this.workletStyle();
          const tag = this.engine.tagOf(this.node);
          const shadowNode = this.engine.shadowNodeOf(this.node);
          if (tag === null || shadowNode === null) return;
          onCleanup(
            this.worklets.bind({ tag, shadowNode }, style, (props) => this.keepDrawn(props)),
          );
        },
        { injector: this.injector },
      );
    });
  }

  /**
   * Commit what the UI thread settled on with the node, which is what lets Reanimated stop
   * applying the view to every commit. The commit is the next one the engine makes, for every view
   * that settled together.
   */
  private keepDrawn(props: Readonly<Record<string, unknown>>): void {
    this.drawn = { ...this.drawn, ...props };
    this.engine.setUiThreadProps(this.node, this.drawn);
  }
}
