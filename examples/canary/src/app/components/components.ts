import { Component, signal } from '@angular/core';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

/**
 * The component pages' claims, each with its result on screen, so a Maestro flow can check them
 * on both platforms: presses and nesting, a switch the app refuses, the text input's events and
 * methods, a modal's events, and an image's load and error.
 */
@Component({
  selector: 'x-components',
  imports: [
    NativeHeader,
    ScrollView,
    Pressable,
    Switch,
    Text,
    TextInput,
    View,
    Modal,
    Image,
    ActivityIndicator,
  ],
  template: `
    <native-header title="Components" />
    <scroll-view
      class="screen"
      [contentContainerStyle]="page.content"
      keyboardShouldPersistTaps="handled"
    >
      <pressable class="card" (press)="outer.set(outer() + 1)">
        <text class="body">outer row</text>
        <pressable class="button" (press)="inner.set(inner() + 1)">
          <text class="button-label">inner button</text>
        </pressable>
      </pressable>
      <text class="body">outer {{ outer() }} inner {{ inner() }}</text>

      <pressable
        class="card"
        (press)="shortPresses.set(shortPresses() + 1)"
        (longPress)="longPresses.set(longPresses() + 1)"
      >
        <text class="button-label">hold me</text>
      </pressable>
      <text class="body">short {{ shortPresses() }} long {{ longPresses() }}</text>

      <text class="body" pressable (press)="textPresses.set(textPresses() + 1)">tap this text</text>
      <text class="body">text presses {{ textPresses() }}</text>

      <view [style]="page.row">
        <switch [(checked)]="refused" (checkedChange)="refuse()" />
        <text class="body">refused switch model {{ refused() }}</text>
      </view>
      <view [style]="page.row">
        <switch [(checked)]="plain" />
        <text class="body">plain switch {{ plain() }}</text>
      </view>

      <text-input
        #field="textInput"
        class="field"
        [(value)]="typed"
        [maxLength]="5"
        placeholder="five at most"
        placeholderTextColor="#6c6c78"
        (changeText)="lastChange.set($event)"
        (focus)="focuses.set(focuses() + 1)"
        (blur)="blurs.set(blurs() + 1)"
        (submitEditing)="submits.set(submits() + 1)"
      />
      <text class="body"
        >typed [{{ typed() }}] change [{{ lastChange() }}] focus {{ focuses() }} blur
        {{ blurs() }} submit {{ submits() }}</text
      >
      <view [style]="page.row">
        <pressable class="card" (press)="field.clear()">
          <text class="button-label">clear field</text>
        </pressable>
        <pressable class="card" (press)="typed.set('code')">
          <text class="button-label">set field</text>
        </pressable>
        <pressable class="card" (press)="field.blur()">
          <text class="button-label">blur field</text>
        </pressable>
      </view>

      <pressable class="button" (press)="modalOpen.set(true)">
        <text class="button-label">open plain modal</text>
      </pressable>
      <text class="body"
        >modal show {{ shows() }} requestClose {{ closes() }} dismiss {{ dismisses() }}</text
      >

      <view [style]="page.row">
        <image
          [source]="goodImage"
          [style]="thumb"
          alt="a remote image"
          (load)="loaded.set(describeLoad($event))"
          (error)="errored.set(errored() + 1)"
        />
        <image [source]="badImage" [style]="thumb" (error)="errored.set(errored() + 1)" />
        <activity-indicator [size]="50" color="#3b6ef5" />
      </view>
      <text class="body">image load [{{ loaded() }}] errors {{ errored() }}</text>
    </scroll-view>

    @if (modalOpen()) {
      <modal
        animationType="slide"
        (requestClose)="closeModal()"
        (show)="shows.set(shows() + 1)"
        (dismiss)="dismisses.set(dismisses() + 1)"
      >
        <view [style]="sheet">
          <text [style]="dark">A plain modal, on white</text>
          <pressable class="button" (press)="modalOpen.set(false)">
            <text class="button-label">close modal</text>
          </pressable>
        </view>
      </modal>
    }
  `,
})
export class ComponentsPage {
  protected readonly page = page;
  protected readonly outer = signal(0);
  protected readonly inner = signal(0);
  protected readonly shortPresses = signal(0);
  protected readonly longPresses = signal(0);
  protected readonly textPresses = signal(0);
  protected readonly refused = signal(false);
  protected readonly plain = signal(false);
  protected readonly typed = signal('');
  protected readonly lastChange = signal('');
  protected readonly focuses = signal(0);
  protected readonly blurs = signal(0);
  protected readonly submits = signal(0);
  protected readonly modalOpen = signal(false);
  protected readonly shows = signal(0);
  protected readonly closes = signal(0);
  protected readonly dismisses = signal(0);
  protected readonly loaded = signal('');
  protected readonly errored = signal(0);

  protected readonly goodImage = { uri: 'https://reactnative.dev/img/tiny_logo.png' };
  protected readonly badImage = { uri: 'https://example.invalid/missing.png' };

  /** The app declines every flip, so the switch must snap back. */
  protected refuse(): void {
    this.refused.set(false);
  }

  protected closeModal(): void {
    this.closes.set(this.closes() + 1);
    this.modalOpen.set(false);
  }

  protected describeLoad(event: unknown): string {
    const source = (event as { nativeEvent?: { source?: { width?: number; height?: number } } })
      .nativeEvent?.source;
    return source ? source.width + 'x' + source.height : 'no source';
  }

  protected readonly thumb = { width: 50, height: 50 };
  protected readonly sheet = { flex: 1, padding: 40, paddingTop: 120, gap: 16 };
  protected readonly dark = { color: '#000000', fontSize: 18 };
}
