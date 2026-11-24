import { Component } from '@angular/core';
import { SafeAreaProvider } from '../../components/src/safe-area-provider.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-device-token-host',
  imports: [View],
  template: `
    <view nativeID="bar"></view>
    <view nativeID="button"></view>
    <view nativeID="gap"></view>
    <view nativeID="atleast"></view>
    <view nativeID="double"></view>
    <view nativeID="divider"></view>
  `,
  styles: `
    #bar {
      padding-top: var(--safe-area-inset-top);
    }
    #button {
      margin-bottom: var(--safe-area-inset-bottom, 16px);
    }
    /* Clear the home indicator, and leave a gap above it. */
    #gap {
      padding-bottom: calc(var(--safe-area-inset-bottom, 0px) + 12px);
    }
    /* Whichever is larger: the indicator, or the padding this design wanted anyway. */
    #atleast {
      padding-bottom: max(var(--safe-area-inset-bottom, 0px), 16px);
    }
    #double {
      padding-top: calc(var(--safe-area-inset-top, 0px) * 2);
    }
    /* The thinnest line the screen can draw, which on a 3x phone is a third of a point. */
    #divider {
      border-bottom-width: var(--hairline, 1px);
    }
  `,
})
export class DeviceTokenHost {}

/** A header clear of the window's controls, in a window that has a safe-area provider. */
@Component({
  selector: 'x-provided-insets',
  imports: [SafeAreaProvider, View],
  template: `
    <safe-area-provider>
      <view nativeID="header"></view>
    </safe-area-provider>
  `,
  styles: `
    #header {
      padding-left: var(--safe-area-inset-titlebar-leading, 0px);
    }
  `,
})
export class ProvidedInsets {}

/** One view with no styles of its own, for a global sheet to style. */
@Component({
  selector: 'x-plain-box',
  imports: [View],
  template: '<view nativeID="box"></view>',
})
export class PlainBox {}
