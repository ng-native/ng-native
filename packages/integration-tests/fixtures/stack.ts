import { Component, input, signal, viewChild } from '@angular/core';
import { SafeAreaView } from '../../components/src/safe-area-view.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeHeaderItem } from '../../router/src/native-header-item.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  selector: 'x-screen-a',
  imports: [Text, View],
  template: `<view><text>screen a</text></view>`,
})
export class ScreenA {
  marker = 'a';
}

@Component({
  selector: 'x-screen-b',
  imports: [Text, View],
  template: `<view><text>screen b</text></view>`,
})
export class ScreenB {
  marker = 'b';
}

/**
 * A page whose content has a bound style, for the props a node is *created* with.
 *
 * On Android that is the only chance: whether a view exists at all is decided from the props it
 * arrives with, so a node created before its bindings ran is flattened for good.
 */
@Component({
  selector: 'x-screen-bound',
  imports: [Text, View],
  template: `<view [style]="box"><text>bound</text></view>`,
})
export class ScreenBound {
  readonly box = { padding: 7 };
}

/** A page with an input, for the binding `withComponentInputBinding()` turns on. */
@Component({
  selector: 'x-screen-titled',
  imports: [Text],
  template: `<text>{{ title() }}</text>`,
})
export class ScreenTitled {
  readonly title = input('untitled');
}

/**
 * A page whose input is required - a route parameter the page cannot render without. It has to be
 * bound before the page's first change detection, or reading it throws NG0950.
 */
@Component({
  selector: 'x-screen-required',
  imports: [Text],
  template: `<text>{{ id() }}</text>`,
})
export class ScreenRequired {
  readonly id = input.required<string>();
}

/** A page that styles its own host, which after ADR 0004 is the screen element itself. */
@Component({
  selector: 'x-screen-styled',
  imports: [Text],
  template: `<text>styled</text>`,
  host: { '[style]': 'style' },
})
export class ScreenStyled {
  readonly style = { flex: 1, backgroundColor: 'red' };
}

/**
 * A page that styles its own host with `position` and an edge inset - a header offset, say -
 * which is exactly what the stack's screen needs for its own absolute fill.
 */
@Component({
  selector: 'x-screen-positioned',
  imports: [Text],
  template: `<text>positioned</text>`,
  host: { '[style]': 'style' },
})
export class ScreenPositioned {
  readonly style = { position: 'relative', top: 40, left: 10, backgroundColor: 'blue' } as const;
}

@Component({
  selector: 'x-stack-host',
  imports: [NativeStackOutlet],
  template: `
    <native-stack-outlet />
    @if (twinShown()) {
      <native-stack-outlet name="twin" #twin />
    }
  `,
})
export class StackHost {
  readonly outlet = viewChild.required(NativeStackOutlet);
  /** A second stack, for a screen another outlet made. */
  readonly twinShown = signal(false);
  readonly twin = viewChild('twin', { read: NativeStackOutlet });
}

/** A second, named stack, beside the first. */
@Component({
  selector: 'x-named-stack-host',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet name="list" />`,
})
export class NamedStackHost {
  readonly outlet = viewChild.required(NativeStackOutlet);
}

/** A page with a native header, the shape ADR 0004 makes possible. */
@Component({
  selector: 'x-screen-headed',
  imports: [NativeHeader, NativeHeaderItem, Text, View],
  template: `
    <native-header title="Settings" [hideShadow]="true" [titleFontSize]="18">
      <native-header-item type="right">
        <text>Done</text>
      </native-header-item>
    </native-header>
    <view><text>body</text></view>
  `,
})
export class ScreenHeaded {}

/** A header written where a page naturally writes it: inside the safe area, after the content. */
@Component({
  selector: 'x-screen-header-in-safe-area',
  imports: [NativeHeader, SafeAreaView, ScrollView, Text],
  template: `
    <safe-area-view>
      <scroll-view><text>body</text></scroll-view>
      <native-header title="Nested" />
    </safe-area-view>
  `,
})
export class ScreenHeaderInSafeArea {}

/** A layout component of the app's own, which a page passes its header into. */
@Component({
  selector: 'x-page-frame',
  imports: [View],
  template: '<view><ng-content /></view>',
})
export class PageFrame {}

/** A header two levels down, projected through a component and behind an @if. */
@Component({
  selector: 'x-screen-header-conditional',
  imports: [NativeHeader, NativeHeaderItem, PageFrame, Text, View],
  template: `
    <x-page-frame>
      <view>
        @if (headed()) {
          <native-header [title]="title()">
            <native-header-item type="right"><text>Edit</text></native-header-item>
          </native-header>
        }
        <text>body</text>
      </view>
    </x-page-frame>
  `,
})
export class ScreenHeaderConditional {
  readonly headed = signal(true);
  readonly title = signal('Draft');
}

/** A header at the top of the page's own template, behind an @if. */
@Component({
  selector: 'x-screen-header-direct',
  imports: [NativeHeader, Text],
  template: `
    @if (headed()) {
      <native-header title="Direct" />
    }
    <text>body</text>
  `,
})
export class ScreenHeaderDirect {
  readonly headed = signal(true);
}
