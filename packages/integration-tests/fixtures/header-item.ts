import { Component, input, signal } from '@angular/core';
import { NativeHeader } from '../../router/src/native-header.ts';
import { NativeHeaderItem, type HeaderItemType } from '../../router/src/native-header-item.ts';

@Component({
  selector: 'x-header-item-host',
  imports: [NativeHeaderItem],
  template: `<native-header-item [type]="type()"><text>Ada</text></native-header-item>`,
})
export class HeaderItemHost {
  readonly type = signal<HeaderItemType | undefined>('title');
}

/** Header actions an app reuses on several pages, as a component of its own. */
@Component({
  selector: 'x-note-actions',
  imports: [NativeHeaderItem],
  template: `
    @if (shown()) {
      <native-header-item type="right">
        <text>{{ label() }}</text>
      </native-header-item>
    }
  `,
})
export class NoteActions {
  readonly shown = input(true);
  readonly label = input('Share');
}

@Component({
  selector: 'x-header-item-in-component',
  imports: [NativeHeader, NativeHeaderItem, NoteActions],
  template: `
    <native-header title="Note">
      <native-header-item type="left"><text>Back</text></native-header-item>
      <x-note-actions [shown]="shown()" [label]="label()" />
      <native-header-item type="center"><text>Title</text></native-header-item>
    </native-header>
  `,
})
export class HeaderItemInComponent {
  readonly shown = signal(true);
  readonly label = signal('Share');
}

/** A title item an app sizes with a class of its own. */
@Component({
  selector: 'x-header-item-styled',
  imports: [NativeHeaderItem],
  template: `<native-header-item type="title" class="wide"><text>Ada</text></native-header-item>`,
})
export class HeaderItemStyled {}
