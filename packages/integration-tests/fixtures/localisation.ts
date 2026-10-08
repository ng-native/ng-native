import { CurrencyPipe, DatePipe, DecimalPipe, I18nPluralPipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { Text, View } from '../../components/src/index.ts';

/** Every way of marking text that works, one per line. */
@Component({
  selector: 'x-messages',
  imports: [Text, View],
  template: `
    <view>
      <text nativeID="greeting" i18n="@@greeting">Hello, {{ name() }}!</text>
      <text nativeID="title" i18n="home screen|The heading on the home screen">Welcome</text>
      <text nativeID="nested" i18n="@@startHint"
        >Tap <text nativeID="inner">here</text> to start</text
      >
      <text nativeID="save" [accessibilityLabel]="saveLabel">{{ saveLabel }}</text>
      <text
        nativeID="close"
        i18n-accessibilityLabel="@@closeLabel"
        accessibilityLabel="Close"
      ></text>
      <text nativeID="basket" i18n="@@basketCount">{count(), plural,
        =0 {No items}
        one {One item}
        other {{{ count() }} items}
      }</text>
      @switch (author()) {
        @case ('me') {
          <text nativeID="reply" i18n="@@reply.mine">You replied</text>
        }
        @default {
          <text nativeID="reply" i18n="@@reply.theirs">{{ name() }} replied</text>
        }
      }
    </view>
  `,
})
export class Messages {
  readonly name = signal('Ada');
  readonly author = signal('me');
  readonly count = signal(0);
  protected readonly saveLabel = $localize`:@@saveButton:Save`;
}

/** A plural through `i18nPlural`, and Angular's locale-aware pipes. */
@Component({
  selector: 'x-formatted',
  imports: [Text, View, CurrencyPipe, DatePipe, DecimalPipe, I18nPluralPipe],
  template: `
    <view>
      <text nativeID="items">{{ count() | i18nPlural: items }}</text>
      <text nativeID="found" i18n="@@found">{count(), plural,
        one {{{ count() }} result}
        other {{{ count() }} results}
      }</text>
      <text nativeID="date">{{ when | date: 'longDate' }}</text>
      <text nativeID="number">{{ 1234567.891 | number: '1.0-2' }}</text>
      <text nativeID="price">{{ 1234.5 | currency: 'EUR' }}</text>
    </view>
  `,
})
export class Formatted {
  readonly count = signal(0);
  protected readonly when = new Date(2026, 8, 24);
  protected readonly items: Record<string, string> = {
    '=0': $localize`:@@basket.empty:Your basket is empty`,
    one: $localize`:@@basket.one:One item`,
    other: $localize`:@@basket.other:# items`,
  };
}
