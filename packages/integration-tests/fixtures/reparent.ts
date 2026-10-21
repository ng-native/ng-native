import { Component, signal, viewChild } from '@angular/core';
import { Pressable } from '../../components/src/pressable.ts';
import { TemplateSlot } from '../../components/src/template-slot.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** Projects its content into a container it can mount again, as a dock or a portal does. */
@Component({
  selector: 'x-remounting',
  imports: [TemplateSlot, View],
  template: `
    <ng-template #content><ng-content /></ng-template>
    @for (mount of mounts(); track mount) {
      <view nativeID="container"
        ><ng-container [templateSlot]="content" [templateSlotContext]="none"
      /></view>
    }
  `,
})
export class Remounting {
  readonly mounts = signal([0]);
  readonly none = {};
}

@Component({
  selector: 'x-reparent',
  imports: [Remounting, Text],
  template: `<x-remounting><text nativeID="moved">projected</text></x-remounting>`,
})
export class Reparent {
  readonly holder = viewChild.required(Remounting);
}

/** Projects its content behind an `@if`, so the content leaves with the block and comes back. */
@Component({
  selector: 'x-fold',
  imports: [View],
  template: `<view nativeID="box">
    @if (open()) {
      <ng-content />
    }
  </view>`,
})
export class Fold {
  readonly open = signal(true);
}

@Component({
  selector: 'x-folded',
  imports: [Fold, Pressable, View],
  template: `<x-fold
    ><view nativeID="row" (layout)="hits.set(hits() + 1)"><view nativeID="inner" /></view
    ><pressable nativeID="press" (press)="hits.set(hits())"
  /></x-fold>`,
})
export class Folded {
  readonly hits = signal(0);
  readonly fold = viewChild.required(Fold);
  readonly pressable = viewChild.required(Pressable);
}

/** As `Fold`, with the content inside an element of the block, which is made again each time. */
@Component({
  selector: 'x-wrapped-fold',
  imports: [View],
  template: `<view nativeID="box">
    @if (open()) {
      <view nativeID="wrap"><ng-content /></view>
    }
  </view>`,
})
export class WrappedFold {
  readonly open = signal(true);
}

/** Elements the test registers `reparent-config` to hoist into `reparent-host`. */
@Component({ selector: 'reparent-host', template: '<ng-content />' })
export class ReparentHost {}

@Component({ selector: 'reparent-config', template: '' })
export class ReparentConfig {}

@Component({
  selector: 'x-wrapped-hoist',
  imports: [ReparentConfig, ReparentHost, WrappedFold],
  template: `<reparent-host nativeID="host"
    ><x-wrapped-fold><reparent-config nativeID="config" /></x-wrapped-fold
  ></reparent-host>`,
})
export class WrappedHoist {
  readonly fold = viewChild.required(WrappedFold);
}
