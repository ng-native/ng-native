import { Component, signal } from '@angular/core';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { Example, Section } from '../example.ts';
import { page } from '../screen-styles.ts';

/**
 * What a view can look like: borders, corners, shadows, transforms and the effects the renderer
 * applies rather than the layout engine.
 *
 * The distinction is worth keeping in mind while reading these. Layout properties change where a
 * box is; everything here changes how it is drawn, and several of them force native to keep a
 * separate layer for the view - which is why a shadow and a gradient both stop a view being
 * flattened away.
 */
@Component({
  selector: 'x-surfaces',
  imports: [Example, NativeHeader, Pressable, ScrollView, Section, Text, View],
  template: `
    <native-header title="Surfaces" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="hint"> How a view is drawn, rather than where it is put. </text>

      <x-section title="Borders">
        <x-example title="Width, colour, style" code="borderWidth, borderColor, borderStyle">
          <view [style]="row">
            <view [style]="solid"></view><view [style]="dashed"></view
            ><view [style]="dotted"></view>
          </view>
        </x-example>
        <x-example
          title="One edge at a time"
          note="Per-side widths and colours, which is how a divider or a leading accent is drawn."
          code="borderLeftWidth: 4, borderBottomWidth: 1"
        >
          <view class="edge" [style]="accentEdge"><text class="body">A leading accent</text></view>
        </x-example>
        <x-example
          title="A hairline"
          note="The thinnest line the screen can draw. Beside the 1px rule below it, it should be
                visibly finer on a 2x or 3x screen."
          code="borderBottomWidth: var(--hairline)"
        >
          <view class="verify-hairline" [style]="rule"></view>
          <view [style]="onePx"></view>
          <text class="hint">hairline above, 1px below</text>
        </x-example>
      </x-section>

      <x-section title="Corners">
        <x-example title="borderRadius" code="borderRadius: 0 | 6 | 16 | 999">
          <view [style]="row">
            @for (r of radii; track r) {
              <view
                [style]="{ width: 56, height: 56, backgroundColor: '#3b6ef5', borderRadius: r }"
              ></view>
            }
          </view>
        </x-example>
        <x-example
          title="Per-corner"
          note="The four corners take different radii, which is how a sheet or a chat bubble is
                shaped."
          code="borderTopLeftRadius, borderBottomRightRadius"
        >
          <view [style]="bubble"></view>
        </x-example>
      </x-section>

      <x-section title="Depth">
        <x-example
          title="Shadow"
          note="iOS draws the offset, radius and opacity; Android maps it onto an elevation, so
                the two are close rather than identical."
          code="shadowColor, shadowOffset, shadowOpacity, shadowRadius, elevation"
        >
          <view [style]="shadowRow">
            <view class="tile" [style]="card"><text class="body">soft</text></view>
            <view class="tile" [style]="cardHard"><text class="body">hard</text></view>
          </view>
        </x-example>
        <x-example
          title="opacity"
          note="Applies to the whole subtree, including text inside it."
          code="opacity: 1 | 0.6 | 0.25"
        >
          <view [style]="row">
            @for (o of opacities; track o) {
              <view
                [style]="{
                  width: 56,
                  height: 56,
                  borderRadius: 8,
                  backgroundColor: '#c83ca0',
                  opacity: o,
                  alignItems: 'center',
                  justifyContent: 'center',
                }"
              >
                <text class="on-colour">{{ o }}</text>
              </view>
            }
          </view>
        </x-example>
      </x-section>

      <x-section title="Transforms" note="Drawn transformed; the layout is unchanged.">
        <x-example title="rotate" code="transform: [{ rotate: '15deg' }]">
          <view [style]="row"> <view [style]="rot15"></view><view [style]="rot45"></view> </view>
        </x-example>
        <x-example title="scale" code="transform: [{ scale: 1.3 }]">
          <view [style]="tallRow">
            <view [style]="scaled"></view>
          </view>
        </x-example>
        <x-example
          title="translate"
          note="The gap it leaves is the space it still occupies in the layout."
          code="transform: [{ translateX: 30 }, { translateY: -8 }]"
        >
          <view [style]="row">
            <view class="tile" [style]="plain"></view><view [style]="shifted"></view>
          </view>
        </x-example>
        <x-example
          title="Order matters"
          note="Rotate-then-translate and translate-then-rotate land in different places."
          code="[{ rotate }, { translateX }] vs [{ translateX }, { rotate }]"
        >
          <view [style]="tallRow">
            <view [style]="rotThenMove"></view>
            <view [style]="moveThenRot"></view>
          </view>
        </x-example>
      </x-section>

      <x-section title="Backgrounds">
        <x-example
          title="A gradient"
          note="Compiled from CSS into the structure Fabric expects, not a library."
          code="background-image: linear-gradient(to right, ...)"
        >
          <view class="verify-gradient"></view>
        </x-example>
        <x-example
          title="A tinted overlay"
          note="A translucent view over content, which is the ordinary way to dim something."
          code="backgroundColor: 'rgba(0, 0, 0, 0.55)'"
        >
          <view [style]="overlayHost">
            <view [style]="overlayBase"></view>
            <view [style]="overlayTint"><text class="on-colour">Dimmed</text></view>
          </view>
        </x-example>
      </x-section>

      <x-section title="Feedback">
        <x-example
          title="Pressed state"
          note="A press changes the style through a signal; there is no CSS :active on a native
                view."
          code="(pressIn) / (pressOut)"
        >
          <pressable
            class="button"
            [style]="held() ? pressed : undefined"
            (pressIn)="held.set(true)"
            (pressOut)="held.set(false)"
          >
            <text class="button-label">{{ held() ? 'Held' : 'Press and hold' }}</text>
          </pressable>
        </x-example>
      </x-section>
    </scroll-view>
  `,
  styles: `
    .tile {
      background-color: var(--card);
    }

    .edge {
      border-bottom-color: var(--line);
    }

    /* On a coloured fill, which is the same in either appearance. */
    .on-colour {
      color: rgb(255, 255, 255);
      font-weight: 700;
    }
  `,
})
export class SurfacesPage {
  protected readonly page = page;
  protected readonly radii = [0, 6, 16, 999];
  protected readonly opacities = [1, 0.6, 0.25];
  protected readonly held = signal(false);

  protected readonly row = { flexDirection: 'row', gap: 10, alignItems: 'center' };
  protected readonly tallRow = { flexDirection: 'row', gap: 24, height: 90, alignItems: 'center' };

  private readonly swatch = { width: 56, height: 56, borderRadius: 8 };
  protected readonly solid = { ...this.swatch, borderWidth: 2, borderColor: '#3b6ef5' };
  protected readonly dashed = {
    ...this.swatch,
    borderWidth: 2,
    borderColor: '#c83ca0',
    borderStyle: 'dashed',
  };
  protected readonly dotted = {
    ...this.swatch,
    borderWidth: 2,
    borderColor: '#2fbf9f',
    borderStyle: 'dotted',
  };

  protected readonly accentEdge = {
    borderLeftWidth: 4,
    borderLeftColor: '#3b6ef5',
    borderBottomWidth: 1,
    paddingLeft: 12,
    paddingVertical: 8,
  };
  protected readonly rule = { height: 1 };
  protected readonly onePx = { height: 1, backgroundColor: '#78788c' };

  protected readonly bubble = {
    width: 140,
    height: 56,
    backgroundColor: '#3b6ef5',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
  };

  protected readonly shadowRow = { flexDirection: 'row', gap: 16, paddingVertical: 10 };
  private readonly cardBase = {
    width: 96,
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  };
  protected readonly card = {
    ...this.cardBase,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  };
  protected readonly cardHard = {
    ...this.cardBase,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.9,
    shadowRadius: 1,
    elevation: 2,
  };

  protected readonly rot15 = {
    ...this.swatch,
    backgroundColor: '#3b6ef5',
    transform: [{ rotate: '15deg' }],
  };
  protected readonly rot45 = {
    ...this.swatch,
    backgroundColor: '#c83ca0',
    transform: [{ rotate: '45deg' }],
  };
  protected readonly scaled = {
    ...this.swatch,
    backgroundColor: '#2fbf9f',
    transform: [{ scale: 1.3 }],
  };
  protected readonly plain = this.swatch;
  protected readonly shifted = {
    ...this.swatch,
    backgroundColor: '#3b6ef5',
    transform: [{ translateX: 30 }, { translateY: -8 }],
  };
  protected readonly rotThenMove = {
    ...this.swatch,
    backgroundColor: '#3b6ef5',
    transform: [{ rotate: '45deg' }, { translateX: 30 }],
  };
  protected readonly moveThenRot = {
    ...this.swatch,
    backgroundColor: '#c83ca0',
    transform: [{ translateX: 30 }, { rotate: '45deg' }],
  };

  protected readonly overlayHost = { height: 90, borderRadius: 10, overflow: 'hidden' };
  protected readonly overlayBase = { position: 'absolute', inset: 0, backgroundColor: '#2fbf9f' };
  protected readonly overlayTint = {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  };

  protected readonly pressed = {
    backgroundColor: '#2748a8',
    transform: [{ scale: 0.97 }],
  };
}
