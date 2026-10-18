import { Component, signal } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { Example, Section } from '../example.ts';
import { page } from '../screen-styles.ts';

const SAMPLE =
  'The quick brown fox jumps over the lazy dog, and then keeps going for long enough to wrap.';

/**
 * Text, which on a native platform is not a box that happens to contain letters.
 *
 * `<text>` is a real text node: it participates in the platform's line breaking, its font
 * metrics, and its accessibility text scaling. Two consequences run through everything here -
 * a view cannot be styled into text, and text nested in text inherits rather than restarting.
 */
@Component({
  selector: 'x-typography',
  imports: [Example, NativeHeader, ScrollView, Section, Text, View],
  template: `
    <native-header title="Typography" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint">
        Real text nodes, laid out by the platform. Everything here is a property of the text, not of
        a box around it.
      </text>

      <x-section title="Size and weight">
        <x-example title="A type scale" code="fontSize: 12 | 14 | 16 | 20 | 28">
          @for (size of sizes; track size) {
            <text class="ink" [style]="{ fontSize: size }">{{ size }}px sample</text>
          }
        </x-example>
        <x-example
          title="Weights"
          note="Native maps these onto the family's real cuts; a family with no medium cut will
                round to the nearest it has."
          code="fontWeight: '300' ... '800'"
        >
          @for (weight of weights; track weight) {
            <text class="ink" [style]="{ fontSize: 17, fontWeight: weight }">
              {{ weight }} - the quick brown fox
            </text>
          }
        </x-example>
        <x-example title="Italic" code="fontStyle: 'italic'">
          <text class="ink" [style]="italic">Slanted, from the family's own italic cut</text>
        </x-example>
      </x-section>

      <x-section title="Spacing">
        <x-example
          title="lineHeight"
          note="Left is default, right is 30. Compare the gap between wrapped lines."
          code="lineHeight: 30"
        >
          <view [style]="twoUp">
            <text class="soft" [style]="col">{{ sample }}</text>
            <text class="soft" [style]="colLoose">{{ sample }}</text>
          </view>
        </x-example>
        <x-example title="letterSpacing" code="letterSpacing: 2">
          <text class="ink" [style]="tracked">Widely tracked heading</text>
          <text class="ink" [style]="tightTracked">Tightly tracked heading</text>
        </x-example>
      </x-section>

      <x-section title="Alignment and truncation">
        <x-example title="textAlign" code="textAlign: 'left' | 'center' | 'right' | 'justify'">
          @for (align of alignments; track align) {
            <text class="soft" [style]="{ fontSize: 14, textAlign: align }">
              {{ align }} - {{ sample }}
            </text>
          }
        </x-example>
        <x-example
          title="numberOfLines"
          note="Truncation happens in native layout, so the ellipsis lands where the platform
                would put it rather than where a JavaScript guess would."
          code='[numberOfLines]="1" and 2'
        >
          <text class="body" [numberOfLines]="1">{{ sample }}</text>
          <text class="body" [numberOfLines]="2">{{ sample }}</text>
        </x-example>
        <x-example title="ellipsizeMode: head" code='ellipsizeMode="head"'>
          <text class="body" [numberOfLines]="1" ellipsizeMode="head">{{ sample }}</text>
        </x-example>
      </x-section>

      <x-section title="Decoration and transform">
        <x-example title="textDecorationLine" code="textDecorationLine: 'underline'">
          <text class="ink" [style]="underline">Underlined</text>
          <text class="muted" [style]="strike">Struck through</text>
        </x-example>
        <x-example
          title="textTransform"
          note="Applied by the platform, so it follows the locale's casing rules rather than
                JavaScript's."
          code="textTransform: 'uppercase' | 'capitalize'"
        >
          <text class="ink" [style]="upper">shouted quietly</text>
          <text class="ink" [style]="caps">each word capitalised</text>
        </x-example>
      </x-section>

      <x-section title="Nesting" note="Text inside text inherits and continues the same line.">
        <x-example
          title="Inherited style"
          note="The inner spans keep the outer size and only change what they name."
          code='<text><text [style]="bold">...</text></text>'
        >
          <text class="soft" [style]="paragraph">
            A sentence with <text class="ink" [style]="strong">bold</text> and
            <text class="link">coloured</text> words set inside it, wrapping as one paragraph rather
            than as three boxes.
          </text>
        </x-example>
        <x-example
          title="A view cannot be text"
          note="The pill is a view inside text, which native lays out as an inline block. It does
                not inherit the font."
          code="<text><view /></text>"
        >
          <text class="soft" [style]="paragraph">
            Before the pill <view [style]="pill"></view> and after it, still one line box.
          </text>
        </x-example>
      </x-section>

      <x-section title="Selection and interaction">
        <x-example
          title="selectable"
          note="Long-press to select. Off by default, because on native it changes what a
                long-press means."
          code='[selectable]="true"'
        >
          <text class="body" [selectable]="true">Long-press to select this line.</text>
        </x-example>
        <x-example title="A tap handler on text" code="(press)">
          <text class="link" [style]="link" (press)="taps.set(taps() + 1)"
            >Tapped {{ taps() }} times</text
          >
        </x-example>
      </x-section>
    </scroll-view>
  `,
  styles: `
    .ink {
      color: var(--text-strong);
    }
    .soft {
      color: var(--text);
    }
    .muted {
      color: var(--text-muted);
    }
    .link {
      color: var(--accent);
    }
    @media (prefers-color-scheme: dark) {
      .link {
        color: rgb(111, 155, 255);
      }
    }
  `,
})
export class TypographyPage {
  protected readonly page = page;
  protected readonly sample = SAMPLE;
  protected readonly sizes = [12, 14, 16, 20, 28];
  protected readonly weights = ['300', '400', '600', '800'] as const;
  protected readonly alignments = ['left', 'center', 'right', 'justify'] as const;
  protected readonly taps = signal(0);

  protected readonly italic = { fontSize: 17, fontStyle: 'italic' };
  protected readonly twoUp = { flexDirection: 'row', gap: 12 };
  protected readonly col = { fontSize: 13, flex: 1 };
  protected readonly colLoose = { fontSize: 13, flex: 1, lineHeight: 30 };
  protected readonly tracked = { fontSize: 16, letterSpacing: 2 };
  protected readonly tightTracked = { fontSize: 16, letterSpacing: -0.5 };
  protected readonly underline = {
    fontSize: 16,
    textDecorationLine: 'underline',
  };
  protected readonly strike = {
    fontSize: 16,
    textDecorationLine: 'line-through',
  };
  protected readonly upper = { fontSize: 16, textTransform: 'uppercase' };
  protected readonly caps = { fontSize: 16, textTransform: 'capitalize' };
  protected readonly paragraph = { fontSize: 16, lineHeight: 24 };
  protected readonly strong = { fontWeight: '700' };
  protected readonly pill = {
    width: 30,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#c83ca0',
  };
  protected readonly link = { fontSize: 16, textDecorationLine: 'underline' };
}
