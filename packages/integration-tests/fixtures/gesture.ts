import { Component, signal } from '@angular/core';
import { NativeGestureBase } from '../../components/src/native-gesture.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-draggable',
  imports: [NativeGestureBase, Text, View],
  template: `<view
    [style]="base"
    testID="card"
    accessibilityLabel="Draft card"
    [gesture]="pan()"
    [trackGesture]="track()"
    ><view><text>Open draft</text></view></view
  >`,
})
export class Draggable {
  readonly base = { flex: 1, backgroundColor: 'red' };
  readonly pan = signal<object>({ name: 'pan' });
  readonly track = signal(true);
}

/** `x-draggable` inside an app, so its gesture is in a component other than the root. */
@Component({
  selector: 'x-gesture-app',
  imports: [Draggable],
  template: `<x-draggable />`,
})
export class GestureApp {}
