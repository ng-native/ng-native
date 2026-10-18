import { Component } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { Example, Section } from '../example.ts';
import { page } from '../screen-styles.ts';

/** A swatch, so every example below is about the layout rather than about the boxes in it. */
const box = (color: string, extra: object = {}) => ({
  backgroundColor: color,
  minWidth: 34,
  minHeight: 34,
  borderRadius: 6,
  ...extra,
});

/**
 * Yoga, which is the layout engine underneath every React Native app and therefore underneath
 * this one. Flexbox, with native defaults rather than the web's: `flexDirection` is `column`,
 * `alignContent` is `flex-start`, and `flexShrink` is 0.
 *
 * Those three defaults are the usual reason a layout written from web habits looks wrong here, so
 * each has an example of its own rather than a footnote.
 */
@Component({
  selector: 'x-layout',
  imports: [Example, NativeHeader, ScrollView, Section, Text, View],
  template: `
    <native-header title="Layout" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint">
        Flexbox through Yoga. The defaults are not the web's, which is where most surprises come
        from.
      </text>

      <x-section title="Direction" note="Column is the default here, not row.">
        <x-example
          title="flexDirection: row"
          note="Three boxes left to right."
          code="{ flexDirection: 'row', gap: 8 }"
        >
          <view [style]="rowGap">
            <view [style]="a"></view><view [style]="b"></view><view [style]="c"></view>
          </view>
        </x-example>

        <x-example
          title="flexDirection: column"
          note="The default. Nothing has to ask for it."
          code="{ gap: 8 }"
        >
          <view [style]="colGap"> <view [style]="a"></view><view [style]="b"></view> </view>
        </x-example>

        <x-example
          title="row-reverse"
          note="Order flips, and so does which edge flex-start means."
          code="{ flexDirection: 'row-reverse' }"
        >
          <view [style]="rowReverse">
            <view [style]="a"></view><view [style]="b"></view><view [style]="c"></view>
          </view>
        </x-example>
      </x-section>

      <x-section title="Main axis" note="justifyContent, along the direction.">
        <x-example title="space-between" code="{ justifyContent: 'space-between' }">
          <view [style]="between">
            <view [style]="a"></view><view [style]="b"></view><view [style]="c"></view>
          </view>
        </x-example>
        <x-example title="space-around" code="{ justifyContent: 'space-around' }">
          <view [style]="around">
            <view [style]="a"></view><view [style]="b"></view><view [style]="c"></view>
          </view>
        </x-example>
        <x-example title="center" code="{ justifyContent: 'center' }">
          <view [style]="centre"> <view [style]="a"></view><view [style]="b"></view> </view>
        </x-example>
      </x-section>

      <x-section title="Cross axis" note="alignItems, across the direction.">
        <x-example
          title="stretch"
          note="The default: children fill the cross axis unless they say otherwise."
          code="{ flexDirection: 'row' }"
        >
          <view [style]="stretch">
            <view [style]="tallA"></view><view [style]="tallB"></view>
          </view>
        </x-example>
        <x-example title="center" code="{ alignItems: 'center' }">
          <view [style]="crossCentre">
            <view [style]="short"></view><view [style]="tall"></view><view [style]="short"></view>
          </view>
        </x-example>
        <x-example title="flex-end" code="{ alignItems: 'flex-end' }">
          <view [style]="crossEnd">
            <view [style]="short"></view><view [style]="tall"></view><view [style]="short"></view>
          </view>
        </x-example>
        <x-example
          title="alignSelf overrides it"
          note="The middle box opts out of the row's alignItems."
          code="{ alignSelf: 'flex-start' }"
        >
          <view [style]="crossCentre">
            <view [style]="short"></view>
            <view [style]="selfStart"></view>
            <view [style]="short"></view>
          </view>
        </x-example>
      </x-section>

      <x-section title="Growing and shrinking">
        <x-example
          title="flex: 1 shares the space"
          note="Each takes an equal share of what is left."
          code="{ flex: 1 }"
        >
          <view [style]="rowGap">
            <view [style]="grow1"></view><view [style]="grow1b"></view>
          </view>
        </x-example>
        <x-example
          title="Different flex values"
          note="Two to one: the first takes twice the remaining space."
          code="{ flex: 2 } and { flex: 1 }"
        >
          <view [style]="rowGap">
            <view [style]="grow2"></view><view [style]="grow1b"></view>
          </view>
        </x-example>
        <x-example
          title="flexShrink is 0 here, not 1"
          note="The web shrinks by default and this does not, so a row of wide children overflows
                rather than squeezing. The second row asks to shrink."
          code="{ flexShrink: 1 }"
        >
          <view [style]="clip">
            <view [style]="rowNoWrap">
              <view [style]="wide"></view><view [style]="wideB"></view>
            </view>
          </view>
          <view [style]="clip">
            <view [style]="rowNoWrap">
              <view [style]="wideShrink"></view><view [style]="wideShrinkB"></view>
            </view>
          </view>
        </x-example>
      </x-section>

      <x-section title="Wrapping and gaps">
        <x-example title="flexWrap: wrap" code="{ flexWrap: 'wrap', gap: 8 }">
          <view [style]="wrap">
            @for (n of many; track n) {
              <view [style]="chip"></view>
            }
          </view>
        </x-example>
        <x-example
          title="rowGap and columnGap"
          note="Different spacing on each axis, with no margins involved."
          code="{ rowGap: 4, columnGap: 20 }"
        >
          <view [style]="splitGap">
            @for (n of many; track n) {
              <view [style]="chip"></view>
            }
          </view>
        </x-example>
      </x-section>

      <x-section title="Out of flow">
        <x-example
          title="position: absolute"
          note="Positioned against the nearest parent, which here is the grey stage."
          code="{ position: 'absolute', top: 8, right: 8 }"
        >
          <view class="relative-box">
            <view [style]="pinTopRight"></view>
            <view [style]="pinBottomLeft"></view>
          </view>
        </x-example>
        <x-example
          title="Inset shorthand"
          note="All four edges at once: the child fills its parent with a margin."
          code="{ position: 'absolute', inset: 10 }"
        >
          <view class="relative-box">
            <view [style]="inset"></view>
          </view>
        </x-example>
        <x-example
          title="zIndex"
          note="The magenta box is written first and still paints on top."
          code="{ zIndex: 2 }"
        >
          <view class="relative-box">
            <view [style]="stackTop"></view>
            <view [style]="stackBottom"></view>
          </view>
        </x-example>
      </x-section>

      <x-section title="Sizing">
        <x-example
          title="aspectRatio"
          note="A width and a ratio; the height follows. Useful where an image's size is not known."
          code="{ aspectRatio: 3, height: undefined }"
        >
          <view [style]="ratio"></view>
        </x-example>
        <x-example
          title="Percentages"
          note="Resolved during native layout, against the parent."
          code="{ width: '60%' }"
        >
          <view [style]="percent"></view>
        </x-example>
        <x-example
          title="min and max"
          note="The box wants 500 wide and is capped, then floored by minHeight."
          code="{ width: 500, maxWidth: '100%', minHeight: 44 }"
        >
          <view [style]="clamped"></view>
        </x-example>
      </x-section>

      <x-section title="Overflow">
        <x-example
          title="overflow: hidden"
          note="The child is larger than the parent and is clipped, including the rounded corner."
          code="{ overflow: 'hidden', borderRadius: 12 }"
        >
          <view class="clip-round">
            <view [style]="oversize"></view>
          </view>
        </x-example>
      </x-section>
    </scroll-view>
  `,
  styles: `
    .relative-box {
      height: 96px;
      background-color: var(--card);
      border-radius: 8px;
    }

    .clip-round {
      height: 70px;
      overflow: hidden;
      border-radius: 12px;
      background-color: var(--card);
    }
  `,
})
export class LayoutPage {
  protected readonly page = page;
  protected readonly many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  private readonly blue = '#3b6ef5';
  private readonly pink = '#c83ca0';
  private readonly teal = '#2fbf9f';

  protected readonly a = box(this.blue);
  protected readonly b = box(this.pink);
  protected readonly c = box(this.teal);
  protected readonly short = box(this.blue, { minHeight: 24 });
  protected readonly tall = box(this.pink, { minHeight: 56 });
  protected readonly tallA = box(this.blue, { minHeight: 56, flex: 1 });
  protected readonly tallB = box(this.pink, { flex: 1 });
  protected readonly selfStart = box(this.teal, { minHeight: 56, alignSelf: 'flex-start' });
  protected readonly chip = box(this.blue, { minWidth: 44, minHeight: 20 });

  protected readonly rowGap = { flexDirection: 'row', gap: 8 };
  protected readonly colGap = { gap: 8 };
  protected readonly rowReverse = { flexDirection: 'row-reverse', gap: 8 };
  protected readonly between = { flexDirection: 'row', justifyContent: 'space-between' };
  protected readonly around = { flexDirection: 'row', justifyContent: 'space-around' };
  protected readonly centre = { flexDirection: 'row', justifyContent: 'center', gap: 8 };
  protected readonly stretch = { flexDirection: 'row', gap: 8, minHeight: 56 };
  protected readonly crossCentre = { flexDirection: 'row', alignItems: 'center', gap: 8 };
  protected readonly crossEnd = { flexDirection: 'row', alignItems: 'flex-end', gap: 8 };

  protected readonly grow1 = box(this.blue, { flex: 1 });
  protected readonly grow1b = box(this.pink, { flex: 1 });
  protected readonly grow2 = box(this.blue, { flex: 2 });

  protected readonly rowNoWrap = { flexDirection: 'row', gap: 8 };
  protected readonly clip = { overflow: 'hidden' };
  protected readonly wide = box(this.blue, { width: 220 });
  protected readonly wideB = box(this.pink, { width: 220 });
  protected readonly wideShrink = box(this.blue, { width: 220, flexShrink: 1 });
  protected readonly wideShrinkB = box(this.pink, { width: 220, flexShrink: 1 });

  protected readonly wrap = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 };
  protected readonly splitGap = {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 4,
    columnGap: 20,
  };

  protected readonly pinTopRight = box(this.blue, { position: 'absolute', top: 8, right: 8 });
  protected readonly pinBottomLeft = box(this.pink, { position: 'absolute', bottom: 8, left: 8 });
  protected readonly inset = {
    position: 'absolute',
    inset: 10,
    backgroundColor: this.teal,
    borderRadius: 6,
  };
  protected readonly stackTop = box(this.pink, {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 60,
    height: 60,
    zIndex: 2,
  });
  protected readonly stackBottom = box(this.blue, {
    position: 'absolute',
    top: 40,
    left: 44,
    width: 60,
    height: 60,
  });

  protected readonly ratio = { aspectRatio: 3, backgroundColor: this.blue, borderRadius: 8 };
  protected readonly percent = {
    width: '60%',
    height: 34,
    backgroundColor: this.pink,
    borderRadius: 6,
  };
  protected readonly clamped = {
    width: 500,
    maxWidth: '100%',
    minHeight: 44,
    backgroundColor: this.teal,
    borderRadius: 6,
  };

  protected readonly oversize = { width: 400, height: 140, backgroundColor: this.blue };
}
