import { Component, inject, signal } from '@angular/core';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { Palette } from '../palette.ts';
import { page } from '../screen-styles.ts';

@Component({
  selector: 'x-primitives',
  imports: [
    NativeHeader,
    ScrollView,
    Switch,
    TextInput,
    ActivityIndicator,
    ImageBackground,
    Image,
    Text,
    View,
    RefreshControl,
  ],
  template: `
    <native-header title="Primitives" />
    <scroll-view
      class="screen"
      [contentContainerStyle]="page.content"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <refresh-control
        [(refreshing)]="refreshing"
        (refresh)="refresh()"
        [tintColor]="palette.current().textStrong"
      />

      <view [style]="page.row">
        <switch [(checked)]="on" />
        <text class="body"
          >switch: <text class="strong">{{ on() }}</text></text
        >
        <activity-indicator [animating]="true" color="#3b6ef5" />
      </view>

      <text-input
        #name
        class="field"
        [(value)]="draft"
        placeholder="type here"
        placeholderTextColor="#6c6c78"
        returnKeyType="next"
        autoCapitalize="words"
        (submitEditing)="notes.focus()"
      />
      <text-input
        #notes
        class="field"
        [(value)]="longer"
        multiline
        placeholder="multiline, submit from the first field lands here"
        placeholderTextColor="#6c6c78"
      />
      <text class="body"
        >typed: <text class="strong">{{ draft() || '-' }}</text></text
      >

      <view [style]="page.row">
        <image [source]="localImage" [style]="thumb" alt="the local asset" />
        <text class="body">local require() asset, sized by itself</text>
      </view>

      <image-background [source]="banner" [style]="bannerBox">
        <text class="body" [style]="bannerLabel">image-background</text>
      </image-background>
    </scroll-view>
  `,
})
export class Primitives {
  protected readonly palette = inject(Palette);
  protected readonly page = page;
  protected readonly on = signal(true);
  protected readonly draft = signal('');
  protected readonly longer = signal('');
  protected readonly refreshing = signal(false);

  /** Pull down: the spinner shows natively, and stops when this says so. */
  protected refresh(): void {
    this.refreshing.set(true);
    setTimeout(() => this.refreshing.set(false), 1200);
  }
  protected readonly localImage = require('../../../assets/local.png');
  protected readonly banner = { uri: 'https://example.invalid/banner.png' };

  protected readonly thumb = { width: 44, height: 44, borderRadius: 6 };
  protected readonly bannerBox = {
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  };
  protected readonly bannerLabel = { paddingLeft: 12 };
}
