import { Component, input, signal } from '@angular/core';
import { NativeHeader } from '../../router/src/native-header.ts';
import {
  NativeHeaderItem,
  type HeaderItemType,
  type HeaderMenu,
} from '../../router/src/native-header-item.ts';

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
      <native-header-item
        type="right"
        accessibilityLabel="Edit the property"
        (press)="edited = edited + 1"
      >
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
  edited = 0;
  filtered = 0;
  saved = 0;
}

/** Bar buttons a component of the header repeats, whose view refreshes after the header's. */
@Component({
  selector: 'x-repeated-actions',
  imports: [NativeHeaderItem],
  template: `
    @for (name of names(); track name) {
      <native-header-item type="right" [title]="name" />
    }
  `,
})
export class RepeatedActions {
  readonly names = input.required<readonly string[]>();
}

/** The same buttons repeated in the page's template and inside a component of the header. */
@Component({
  selector: 'x-header-moved-buttons',
  imports: [NativeHeader, NativeHeaderItem, RepeatedActions],
  template: `
    <native-header title="Moved">
      @for (name of leading(); track name) {
        <native-header-item type="left" [title]="name" />
      }
      <x-repeated-actions [names]="trailing()" />
    </native-header>
    <text>{{ label() }}</text>
  `,
})
export class HeaderMovedButtons {
  readonly leading = signal<readonly string[]>(['One', 'Two']);
  readonly trailing = signal<readonly string[]>(['Three', 'Four']);
  readonly label = signal('Same');
}

/** A bar button that opens a menu beside a plain one, a spacer between them. */
@Component({
  selector: 'x-header-menu-host',
  imports: [NativeHeader, NativeHeaderItem],
  template: `
    <native-header title="Menus">
      <native-header-item
        type="left"
        systemImageName="ellipsis"
        accessibilityLabel="More"
        [menu]="menu()"
        [disabled]="disabled()"
        (press)="pressed = pressed + 1"
        (menuSelect)="chosen.push($event)"
      />
      <native-header-item
        type="right"
        systemImageName="gear"
        [menu]="settings()"
        (menuSelect)="otherChosen.push($event)"
      />
      <native-header-item type="right" [spacing]="gap()" />
      <native-header-item type="right" title="Save" (press)="saved = saved + 1" />
      <native-header-item type="right" [spacing]="filled()">
        <text>Filled</text>
      </native-header-item>
    </native-header>
  `,
})
export class HeaderMenuHost {
  readonly menu = signal<HeaderMenu | undefined>({
    title: 'Sort',
    items: [
      { type: 'action', id: 'name', title: 'Name', systemImageName: 'textformat', state: 'on' },
      { type: 'action', id: 'trash', title: 'Delete', destructive: true, disabled: true },
      {
        type: 'submenu',
        title: 'More',
        systemImageName: 'folder',
        singleSelection: true,
        items: [
          { type: 'action', id: 'deep', title: 'Deep', hidden: true },
          {
            type: 'submenu',
            title: 'Inline',
            displayInline: true,
            destructive: true,
            items: [{ type: 'action', id: 'deeper', title: 'Deeper' }],
          },
        ],
      },
    ],
  });
  readonly settings = signal<HeaderMenu | undefined>({
    items: [{ type: 'action', id: 'name', title: 'Name' }],
  });
  readonly disabled = signal(false);
  readonly gap = signal<number | null | undefined>(12);
  readonly filled = signal<number | undefined>(4);
  readonly chosen: string[] = [];
  readonly otherChosen: string[] = [];
  pressed = 0;
  saved = 0;
}
