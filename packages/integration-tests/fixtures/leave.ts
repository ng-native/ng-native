import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/**
 * `animate.leave` with a class whose stylesheet transitions opacity. The element has to stay in
 * the tree, faded but present, until the transition ends.
 */
@Component({
  selector: 'x-leaving',
  imports: [Text, View],
  template: `
    @if (shown()) {
      <view class="panel" animate.leave="going">
        <text>panel</text>
      </view>
    }
  `,
  styles: `
    .panel {
      opacity: 1;
      background-color: rgb(0, 0, 0);
      transition: opacity 300ms linear;
    }

    .panel.going {
      opacity: 0;
    }
  `,
})
export class Leaving {
  readonly shown = signal(true);
}

/**
 * `animate.enter` with a class carrying a `@keyframes` animation, which plays from its own frames.
 */
@Component({
  selector: 'x-entering',
  imports: [Text, View],
  template: `
    @if (shown()) {
      <view class="panel" animate.enter="arriving">
        <text>panel</text>
      </view>
    }
  `,
  styles: `
    @keyframes arrive {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .panel {
      opacity: 1;
    }

    .panel.arriving {
      animation: arrive 300ms linear;
    }
  `,
})
export class Entering {
  readonly shown = signal(false);
}

/**
 * `animate.enter` with a class whose resting style has the transition, as a fade-in is written
 * on the web: the element starts in the enter style and eases to its own.
 */
@Component({
  selector: 'x-fading-in',
  imports: [Text, View],
  template: `
    @if (shown()) {
      <view class="panel" animate.enter="entering">
        <text>panel</text>
      </view>
    }
  `,
  styles: `
    .panel {
      opacity: 1;
      transition: opacity 300ms linear;
    }

    .panel.entering {
      opacity: 0;
    }
  `,
})
export class FadingIn {
  readonly shown = signal(false);
}
