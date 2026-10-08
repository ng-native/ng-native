import { Component, signal } from '@angular/core';
import { Pressable, Text, View } from '../../components/src/index.ts';

@Component({
  selector: 'x-i18n',
  imports: [Pressable, Text, View],
  template: `
    <view>
      <text nativeID="greeting" i18n="@@greeting">Hello, {{ name() }}!</text>
      <text nativeID="plain" i18n>Plain text</text>
      <text nativeID="basket" i18n="@@basket">{count(), plural,
        =0 {No items}
        one {One item}
        other {{{ count() }} items}
      }</text>
      <text nativeID="reply" i18n="@@reply"
        >{author(), select, me {You} other {{{ name() }}}} replied</text
      >
      <text nativeID="owned" i18n="@@owned">{author(), select,
        me {{count(), plural, one {You have one} other {You have {{ count() }}}}}
        other {They have some}
      }</text>
      <text nativeID="entity" i18n="@@entity">{count(), plural,
        other {Fish &amp; chips &lt; £5}
      }</text>
      <text nativeID="element" i18n="@@element">{count(), plural,
        other {Before <text>inside</text> after}
      }</text>
      <text nativeID="html" i18n="@@html">{count(), plural,
        other {Pay <b title="at once">now</b>}
      }</text>
      <pressable nativeID="close" i18n-accessibilityLabel="@@close" accessibilityLabel="Close" />
    </view>
  `,
})
export class I18nHost {
  readonly name = signal('Ada');
  readonly count = signal(0);
  readonly author = signal('me');
}
