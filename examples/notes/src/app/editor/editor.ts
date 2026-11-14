import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { lucideTrash2 } from '@ng-icons/lucide';
import { NgIcon } from '@ng-native/icons';
import { Dialogs, Keyboard } from '@ng-native/device';
import { Haptics } from '@ng-native/expo/haptics';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from '@ng-native/components';
import { NativeHeader, NativeHeaderItem, NativeNavigation } from '@ng-native/router';
import { wordCount } from '../data/note.ts';
import { Notes } from '../sync/notes.ts';

const AUTOSAVE_DELAY_MS = 500;

/**
 * Title and body, saved a moment after typing stops. There is no save button: the note behind
 * `id()` already exists, or `add()` makes it the first time there is something worth keeping.
 */
@Component({
  selector: 'app-editor',
  imports: [
    KeyboardAvoidingView,
    NativeHeader,
    NativeHeaderItem,
    NgIcon,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
  ],
  providers: [provideIcons({ lucideTrash2 })],
  template: `
    <keyboard-avoiding-view class="flex-1 bg-white dark:bg-black" behavior="padding">
      <native-header [title]="isNew() ? 'New note' : 'Note'" backTitle="Notes">
        @if (canDelete()) {
          <native-header-item type="right">
            <pressable
              class="size-8 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="Delete note"
              (press)="remove()"
            >
              <ng-icon name="lucideTrash2" size="19" color="#e11d48" />
            </pressable>
          </native-header-item>
        }
      </native-header>

      <scroll-view
        class="flex-1 px-5 pt-4 macos:px-4 macos:pt-3"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <text-input
          class="text-2xl font-bold text-zinc-900 dark:text-white macos:text-[22px]"
          placeholder="Title"
          accessibilityLabel="Title"
          autoCapitalize="sentences"
          [(value)]="title"
          (changeText)="scheduleSave()"
        />
        <text-input
          class="mt-3 min-h-32 text-base text-zinc-700 dark:text-zinc-300 macos:mt-2 macos:text-[13px]"
          placeholder="Start writing..."
          accessibilityLabel="Note body"
          [multiline]="true"
          [(value)]="body"
          (changeText)="scheduleSave()"
        />
      </scroll-view>

      <view
        [class.keyboard-up]="keyboardUp()"
        class="bottom-bar flex-row items-center justify-between border-t-hairline border-zinc-200 bg-white px-5 pt-2 dark:border-zinc-800 dark:bg-black"
      >
        <text class="text-xs text-zinc-400 macos:text-[11px]">{{ wordCountLabel() }}</text>
        <text class="text-xs text-zinc-400 macos:text-[11px]">{{ savedLabel() }}</text>
      </view>
    </keyboard-avoiding-view>
  `,
  styleUrl: './editor.css',
})
export class Editor {
  private readonly notes = inject(Notes);
  private readonly navigation = inject(NativeNavigation);
  private readonly dialogs = inject(Dialogs);
  private readonly haptics = inject(Haptics);
  /** The bar sits on the keyboard then, with no home indicator under it to clear. */
  protected readonly keyboardUp = inject(Keyboard).visible;

  /** Set only when opened from the list; its absence is what makes this a new note. */
  readonly id = input<string>();

  private readonly existing = computed(() => this.notes.find(this.id() ?? ''));
  protected readonly isNew = computed(() => !this.existing());

  protected readonly title = linkedSignal(() => this.existing()?.title ?? '');
  protected readonly body = linkedSignal(() => this.existing()?.body ?? '');

  /** The id a brand-new note gets the moment it is first saved. */
  private readonly createdId = signal<string | null>(null);
  private readonly noteId = computed(() => this.id() ?? this.createdId());
  protected readonly canDelete = computed(() => this.noteId() !== null);

  protected readonly wordCountLabel = computed(() => {
    const count = wordCount(this.body());
    return `${count} word${count === 1 ? '' : 's'}`;
  });
  protected readonly saving = signal(false);
  protected readonly savedLabel = computed(() => {
    if (!this.title().trim() && !this.body().trim()) return '';
    return this.saving() ? 'Saving...' : 'Saved';
  });

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saving.set(true);
    this.saveTimer = setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
  }

  protected async remove(): Promise<void> {
    const id = this.noteId();
    if (!id) return;
    const sure = await this.dialogs.confirm('Delete this note?', {
      message: 'This cannot be undone.',
      destructive: true,
    });
    if (!sure) return;
    await this.notes.remove(id);
    this.haptics.notify('success');
    this.navigation.back();
  }

  private async save(): Promise<void> {
    const title = this.title().trim();
    const body = this.body();
    if (!title && !body) {
      this.saving.set(false);
      return;
    }

    const id = this.noteId();
    if (id) {
      await this.notes.update(id, { title: title || 'Untitled', body });
    } else {
      const note = await this.notes.add(title || 'Untitled', body);
      this.createdId.set(note.id);
    }
    this.saving.set(false);
  }
}
