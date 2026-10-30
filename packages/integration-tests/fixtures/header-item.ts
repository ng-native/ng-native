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

/** A sheet's bar as UIKit apps draw it: Close on the left, a prominent Save on the right. */
@Component({
  selector: 'x-header-bar-buttons',
  imports: [NativeHeader, NativeHeaderItem, NoteActions],
  template: `
    <native-header title="New property">
      <native-header-item
        type="left"
        systemImageName="xmark"
        accessibilityLabel="Close"
        (press)="closed = closed + 1"
      />
      <native-header-item systemImageName="gear" accessibilityLabel="Settings" />
      <native-header-item type="right" accessibilityLabel="Edit the property">
        <text>Edit</text>
      </native-header-item>
      @if (filtering()) {
        <native-header-item
          type="right"
          systemImageName="line.3.horizontal.decrease"
          [tintColor]="tint()"
          [sharesBackground]="false"
          (press)="filtered = filtered + 1"
        />
      }
      <x-note-actions [shown]="shared()" />
      <native-header-item
        type="right"
        [title]="saveTitle()"
        barButtonItemStyle="prominent"
        hidesSharedBackground
        [disabled]="saving()"
        [hidden]="saveHidden()"
        (press)="saved = saved + 1"
      />
      <native-header-item type="right" systemImageName="star">
        @if (starred()) {
          <text>Starred</text>
        }
      </native-header-item>
    </native-header>
  `,
})
export class HeaderBarButtonsHost {
  readonly filtering = signal(true);
  readonly shared = signal(false);
  readonly saving = signal(false);
  readonly saveHidden = signal(false);
  readonly saveTitle = signal<string | undefined>('Save');
  readonly starred = signal(false);
  readonly tint = signal<string | undefined>(undefined);
  closed = 0;
  filtered = 0;
  saved = 0;
}
