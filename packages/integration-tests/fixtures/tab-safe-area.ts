import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { ScreenSafeAreaView } from '../../router/src/screen-safe-area-view.ts';
import { TabSafeAreaView } from '../../router/src/tab-safe-area-view.ts';

@Component({
  selector: 'x-tab-safe-area',
  imports: [TabSafeAreaView, Text, View],
  template: `
    <tab-safe-area-view nativeID="all"><text>everything</text></tab-safe-area-view>
    <!-- The panel pattern: the background on the parent, the inset inside it. -->
    <view nativeID="panel">
      <tab-safe-area-view nativeID="some" class="content" [edges]="edges()">
        <text>above the tab bar</text>
      </tab-safe-area-view>
    </view>
  `,
  styles: `
    .content {
      padding-bottom: 16px;
    }
  `,
})
export class TabSafeAreaHost {
  readonly edges = signal<readonly ('top' | 'bottom')[]>(['bottom']);
}

/** A stack page under a translucent bar: the controls and the list start below it. */
@Component({
  selector: 'x-screen-safe-area',
  imports: [ScreenSafeAreaView, Text],
  template: `
    <screen-safe-area-view nativeID="page" [edges]="edges()">
      <text>Schedule</text>
    </screen-safe-area-view>
    <screen-safe-area-view nativeID="every"><text>everything</text></screen-safe-area-view>
  `,
})
export class ScreenSafeAreaHost {
  readonly edges = signal<readonly ('top' | 'bottom')[]>(['top']);
}

/** What the page below binds on its header, for a test to change. */
export const header = signal<{ hidden?: boolean; translucent?: boolean; absent?: boolean }>({});

/** A page of a stack with a header over it, as an app writes one. */
@Component({
  selector: 'x-planner',
  imports: [NativeHeader, ScreenSafeAreaView, Text],
  template: `
    @if (!header().absent) {
      <native-header
        title="Planner"
        [hidden]="header().hidden"
        [translucent]="header().translucent"
      />
    }
    <screen-safe-area-view nativeID="planner" [edges]="['top', 'bottom']">
      <text>Schedule</text>
    </screen-safe-area-view>
  `,
})
export class Planner {
  protected readonly header = header;
}

@Component({
  selector: 'x-planner-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class PlannerStack {}
