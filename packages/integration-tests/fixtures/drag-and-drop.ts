import { Component, signal } from '@angular/core';
import {
  DragItem,
  FileDrop,
  type DragItemValue,
  type FileDropEvent,
} from '../../components/src/drag-and-drop.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-drag-and-drop',
  imports: [DragItem, FileDrop, View],
  template: `
    <view
      testID="target"
      (fileDragEnter)="log('enter', $event)"
      (fileDragLeave)="heard.update((all) => [...all, 'leave'])"
      (fileDrop)="log('drop', $event)"
    ></view>
    <view testID="enter-only" (fileDragEnter)="log('enter', $event)"></view>
    <view testID="plain"></view>
    <view testID="source" [dragItem]="item()"></view>
  `,
})
export class DragAndDrop {
  readonly heard = signal<string[]>([]);
  readonly item = signal<DragItemValue | null>(null);

  log(name: string, event: FileDropEvent): void {
    const files = event.files.map((file) => `${file.name} ${file.uri}`).join(', ');
    const what = [files, event.text ?? '', event.urls.join(', ')].filter(Boolean).join(' | ');
    this.heard.update((all) => [...all, `${name} ${what}`]);
  }
}
