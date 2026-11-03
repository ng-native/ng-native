import { Component, inject, signal } from '@angular/core';
import { Image, Pressable, ScrollView, Text, View } from '@ng-native/components';
import { Image as Assets } from 'react-native';
import { TextRecognition, type RecognizedText } from '@ng-native/expo/text-recognition';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

const SAMPLE = require('../../../assets/receipt.png') as number;

/**
 * `TextRecognition`: the text in a bundled receipt, with each line's confidence and box.
 */
@Component({
  selector: 'x-text-recognition',
  imports: [Image, NativeHeader, Pressable, ScrollView, Text, View],
  template: `
    <native-header title="Text recognition" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="body" testID="available">Available: {{ ocr.available() }}</text>
      <image [source]="sample" [style]="preview" resizeMode="contain" />
      <pressable class="button" testID="read-sample" (press)="readSample()">
        <text class="button-label">Read the receipt</text>
      </pressable>

      @if (result(); as found) {
        <text class="hint" testID="size">{{ found.width }} by {{ found.height }}</text>
        <text class="body" testID="text">{{ found.text }}</text>
        @for (line of found.lines; track $index) {
          <text class="hint">{{ describe(line) }}</text>
        }
      }
      @if (error(); as message) {
        <text class="body danger" testID="error">{{ message }}</text>
      }
    </scroll-view>
  `,
})
export class TextRecognitionPage {
  protected readonly ocr = inject(TextRecognition);
  protected readonly page = page;
  protected readonly sample = SAMPLE;
  protected readonly result = signal<RecognizedText | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly preview = { width: '100%', aspectRatio: 1.5 };

  /** A release build bundles the image as a file; a development one serves it from Metro. */
  protected async readSample(): Promise<void> {
    const uri = Assets.resolveAssetSource(SAMPLE)?.uri ?? '';
    if (!uri.startsWith('http')) return this.read(uri);
    const { Directory, File, Paths } =
      require('expo-file-system') as typeof import('expo-file-system');
    this.error.set(null);
    let file: InstanceType<typeof File>;
    try {
      file = await File.downloadFileAsync(uri, new Directory(Paths.cache), { idempotent: true });
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    await this.read(file.uri);
  }

  protected describe(line: RecognizedText['lines'][number]): string {
    const { x, y, width, height } = line.box;
    const box = [x, y, width, height].map(Math.round).join(', ');
    return `${line.text} (${line.confidence.toFixed(2)}) at ${box}`;
  }

  private async read(uri: string): Promise<void> {
    this.error.set(null);
    try {
      const found = await this.ocr.recognize(uri);
      console.log('[text-recognition]', JSON.stringify(found));
      this.result.set(found);
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : String(failure));
    }
  }
}
