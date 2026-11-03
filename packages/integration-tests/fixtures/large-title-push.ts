import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeHeaderItem } from '../../router/src/native-header-item.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

/** Whether the detail page's large-title header is hidden. */
export const detailHidden = signal(false);

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

/** The stack's root page, with no header: its screen gets the hidden stand-in. */
@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

/** A pushed page with a large title and a view in the bar. */
@Component({
  selector: 'x-detail',
  imports: [NativeHeader, NativeHeaderItem, Text, View],
  template: `
    <text>detail</text>
    <native-header largeTitle title="Detail" [hidden]="hidden()">
      <native-header-item type="right"><view /></native-header-item>
    </native-header>
  `,
})
export class Detail {
  protected readonly hidden = detailHidden;
}

/** A pushed page with an inline title. */
@Component({
  selector: 'x-plain',
  imports: [NativeHeader, Text],
  template: `<text>plain</text><native-header title="Plain" />`,
})
export class Plain {}

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'detail', component: Detail },
  { path: 'plain', component: Plain },
];

/** A stack whose root page has the large title, shown from the stack's first commit. */
export const largeRootRoutes: Routes = [{ path: '', component: Detail }];
