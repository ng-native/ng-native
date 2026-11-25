import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { VirtualList } from '../../components/src/virtual-list.ts';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  selector: 'x-sheet-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class SheetShell {}

/** A page with a bar and a list, shown pushed, presented, or in a stack presented as a sheet. */
@Component({
  selector: 'x-sheet-page',
  imports: [NativeHeader, ScrollView, Text, VirtualList],
  template: `
    <native-header title="Sheet" />
    <scroll-view nativeID="scroll"><text>Body</text></scroll-view>
    <virtual-list nativeID="list" [items]="rows" />
  `,
})
export class SheetPage {
  protected readonly rows = [1, 2, 3];
}

@Component({
  selector: 'x-sheet-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class SheetStack {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

export const sheetRoutes: Routes = [
  { path: '', component: Home },
  { path: 'page', component: SheetPage },
  {
    path: 'sheet',
    component: SheetStack,
    children: [
      { path: '', component: SheetPage },
      { path: 'page', component: SheetPage },
    ],
  },
];
