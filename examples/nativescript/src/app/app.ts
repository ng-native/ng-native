import { Component, inject, signal } from '@angular/core';
import {
  Pressable,
  SafeAreaProvider,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  View,
} from '@ng-native/components';
import { androidContext, NativeScript, NsView } from '@ng-native/nativescript';
import { scheduleOnRN } from 'react-native-worklets';
import { badge } from './badge.ts';
import { torus } from './torus.ts';

/** A line of what the device says about itself, read through NativeScript. */
interface Fact {
  readonly label: string;
  readonly value: string;
}

@Component({
  selector: 'app-root',
  imports: [NsView, Pressable, SafeAreaProvider, SafeAreaView, ScrollView, Switch, Text, View],
  host: { style: 'flex: 1' },
  styles: `
    .screen {
      flex: 1;
      background-color: light-dark(#f2f2f7, #000);
    }
    .content {
      padding: 20px;
      gap: 16px;
    }
    .title {
      font-size: 34px;
      font-weight: 700;
      color: light-dark(#000, #fff);
    }
    .caption {
      font-size: 15px;
      color: #8e8e93;
    }
    .panel {
      border-radius: 12px;
      background-color: light-dark(#fff, #1c1c1e);
      padding: 4px 16px;
    }
    .fact {
      flex-direction: row;
      justify-content: space-between;
      padding: 12px 0;
      gap: 12px;
    }
    .label {
      font-size: 16px;
      color: light-dark(#000, #fff);
    }
    .value {
      font-size: 16px;
      color: #8e8e93;
      flex-shrink: 1;
      text-align: right;
    }
    .scene {
      height: 260px;
      border-radius: 12px;
      overflow: hidden;
    }
    .badge {
      height: 80px;
      border-radius: 12px;
      overflow: hidden;
    }
    .button {
      padding: 14px;
      border-radius: 12px;
      background-color: #5856d6;
      align-items: center;
    }
    .button-text {
      color: #fff;
      font-size: 16px;
      font-weight: 600;
    }
  `,
  template: `
    <safe-area-provider>
      <safe-area-view class="screen" [edges]="['top']">
        <scroll-view>
          <view class="content">
            <text class="title">NativeScript</text>
            <text class="caption"
              >Read from the platform's own APIs, synchronously, in TypeScript.</text
            >

            <view class="panel">
              @for (fact of facts; track fact.label) {
                <view class="fact">
                  <text class="label">{{ fact.label }}</text>
                  <text class="value" testID="fact-value">{{ fact.value }}</text>
                </view>
              }
            </view>

            @if (ios) {
              <ns-view
                class="scene"
                testID="scene"
                [view]="torus"
                [props]="{ wireframe: highlighted() }"
              />
            } @else {
              <ns-view
                class="badge"
                testID="badge"
                [view]="badge"
                [props]="{ text: 'An android.widget.TextView', highlighted: highlighted() }"
              />
            }
            <view class="panel">
              <view class="fact">
                <text class="label">{{ ios ? 'Wireframe' : 'Highlighted' }}</text>
                <switch accessibilityLabel="Highlight" [(checked)]="highlighted" />
              </view>
            </view>
            <pressable class="button" accessibilityRole="button" (press)="confirm()">
              <text class="button-text"
                >Ask with {{ ios ? 'a UIAlertController' : 'an AlertDialog' }}</text
              >
            </pressable>
            <text class="caption" testID="answer">{{ answer() }}</text>
          </view>
        </scroll-view>
      </safe-area-view>
    </safe-area-provider>
  `,
})
export class App {
  private readonly native = inject(NativeScript);

  protected readonly ios = this.native.platform === 'ios';
  protected readonly torus = torus;
  protected readonly badge = badge;
  protected readonly highlighted = signal(false);
  protected readonly answer = signal('');

  protected readonly facts: readonly Fact[] = [
    {
      label: 'Model',
      value:
        this.native.call({
          ios: () => UIDevice.currentDevice.model,
          android: () => `${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}`,
        }) ?? 'Unknown',
    },
    {
      label: 'System',
      value:
        this.native.call({
          ios: () => `${UIDevice.currentDevice.systemName} ${UIDevice.currentDevice.systemVersion}`,
          android: () => `Android ${android.os.Build.VERSION.RELEASE}`,
        }) ?? 'Unknown',
    },
    {
      label: 'Processors',
      value: String(
        this.native.call({
          ios: () => NSProcessInfo.processInfo.activeProcessorCount,
          android: () => java.lang.Runtime.getRuntime().availableProcessors(),
        }) ?? 'Unknown',
      ),
    },
    {
      label: 'Time zone',
      value:
        this.native.call({
          ios: () => NSTimeZone.localTimeZone.name,
          android: () => java.util.TimeZone.getDefault().getID(),
        }) ?? 'Unknown',
    },
  ];

  /** Asks with the platform's own alert, on the main thread, and shows which button was tapped. */
  protected async confirm(): Promise<void> {
    if (!this.native.platform) return;
    const choice = await new Promise<string>((answer, fail) =>
      this.native
        .runOnUI(this.ios ? ask.onIOS : ask.onAndroid, 'Try NativeScript?', answer)
        .catch(fail),
    );
    this.answer.set(`You chose "${choice}".`);
  }
}

const CHOICES = ['Not now', 'Sounds good'];

/** The worklets that ask. An object, so hot reloading leaves them worklets: see `nsView`. */
const ask = {
  /** UIKit's alert, on the UI runtime: the answer goes back to the JavaScript thread. */
  onIOS(title: string, reply: (choice: string) => void): void {
    'worklet';
    const alert = UIAlertController.alertControllerWithTitleMessagePreferredStyle(
      title,
      'Presented by a worklet on the main thread.',
      UIAlertControllerStyle.Alert,
    );
    for (const choice of CHOICES) {
      alert.addAction(
        UIAlertAction.actionWithTitleStyleHandler(choice, UIAlertActionStyle.Default, () =>
          scheduleOnRN(reply, choice),
        ),
      );
    }
    let top = UIApplication.sharedApplication.keyWindow!.rootViewController!;
    while (top.presentedViewController) top = top.presentedViewController;
    top.presentViewControllerAnimatedCompletion(alert, true, () => {});
  },

  /** Android's dialog, on the main thread in this same runtime, so its listener replies itself. */
  onAndroid(title: string, reply: (choice: string) => void): void {
    'worklet';
    const listener = (choice: string) =>
      new android.content.DialogInterface.OnClickListener({ onClick: () => reply(choice) });
    new android.app.AlertDialog.Builder(androidContext() as android.content.Context)
      .setTitle(title)
      .setMessage('Presented on the main thread.')
      .setNegativeButton(CHOICES[0]!, listener(CHOICES[0]!))
      .setPositiveButton(CHOICES[1]!, listener(CHOICES[1]!))
      .show();
  },
};
