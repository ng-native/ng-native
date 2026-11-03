import { Component } from '@angular/core';
import { View } from '../../components/src/view.ts';

/** Custom properties used where nothing defines them, with and without a fallback. */
@Component({
  selector: 'x-undefined-token',
  imports: [View],
  template: `
    <view class="pinned" nativeID="a"></view>
    <view class="pinned" nativeID="b"></view>
    <view class="fallback" nativeID="c"></view>
    <view class="defined" nativeID="d"></view>
    <view class="scoped" nativeID="e"><view class="inner" nativeID="f"></view></view>
    <view class="layered" nativeID="g"></view>
  `,
  styles: `
    .pinned {
      background-color: var(--backdrop);
    }
    .fallback {
      background-color: var(--unset-tint, red);
    }
    .defined {
      --tone: blue;
      background-color: var(--tone);
    }
    .scoped {
      --edge: 4px;
    }
    .inner {
      padding: var(--edge);
    }
    .layered {
      background: linear-gradient(red, blue), var(--layer, center / cover);
    }
  `,
})
export class UndefinedToken {}
