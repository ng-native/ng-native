import { Component } from '@angular/core';
import { Pressable, Text, TextInput, View } from '@ng-native/components';

/**
 * A catalogue of everything the CSS engine supports, styled entirely by the `styles:` block
 * below. Nothing here uses a bound `[style]` object.
 *
 * Every row states what it should look like, so a regression shows up as a mismatch between the
 * caption and the thing next to it rather than as "something looks a bit off". Green means the
 * feature resolved; grey text is the caption. The colours are the app's palette tokens, so the
 * page reads in either appearance.
 */
@Component({
  selector: 'x-css-demo',
  imports: [Pressable, TextInput, Text, View],
  styles: [
    `
      :host {
        gap: 18px;
      }

      .section {
        gap: 6px;
      }
      .section-title {
        color: var(--success);
        font-size: 15px;
        font-weight: 700;
      }
      .row {
        flex-direction: row;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .cap {
        color: var(--text-muted);
        font-size: 12px;
      }
      text {
        color: var(--text);
        font-size: 14px;
      }

      /* ---- selectors ---- */
      #by-id {
        color: var(--success);
      }
      .sel .descendant {
        color: var(--success);
      }
      .sel > .child {
        color: var(--success);
      }
      .sel .nested .descendant-only {
        color: var(--danger);
      }
      [data-flag] {
        color: var(--success);
      }
      [data-kind='alpha'] {
        color: var(--success);
      }
      [data-kind^='be'] {
        color: var(--success);
      }
      .pick:is(.one, .two) {
        color: var(--success);
      }
      .pick:not(.one, .two) {
        color: var(--danger);
      }
      .pick:where(.one) {
        font-style: italic;
      }

      /* ---- cascade ---- */
      .cascade {
        color: var(--danger);
      }
      .cascade.wins {
        color: var(--success);
      }
      .later {
        color: var(--danger);
      }
      .later {
        color: var(--success);
      }
      .shout {
        color: var(--success) !important;
      }
      .shout-loser {
        color: var(--danger);
      }

      /* ---- inheritance ---- */
      .inherits {
        color: var(--success);
        font-size: 15px;
        letter-spacing: 1px;
      }

      /* ---- tokens, defined in the app's global sheet ---- */
      .token-swatch {
        background-color: var(--accent);
        width: 34px;
        height: 18px;
        border-radius: 4px;
      }
      .token-local {
        --accent: #7fd18a;
      }
      .token-fallback {
        color: var(--nope, #7fd18a);
      }

      /* ---- media queries ---- */
      .media-note {
        color: var(--danger);
      }
      @media (min-width: 300px) {
        .media-note {
          color: var(--success);
        }
      }
      @media (orientation: portrait) {
        .portrait-only {
          color: var(--success);
        }
      }
      @media (prefers-color-scheme: dark) {
        .scheme {
          color: var(--success);
        }
      }

      /* ---- pseudo-state ---- */
      .press {
        background-color: var(--card);
        padding: 8px 14px;
        border-radius: 8px;
      }
      .press:active {
        background-color: var(--success);
      }
      .off {
        color: var(--text-muted);
      }
      .off[data-disabled] {
        color: var(--danger);
      }
      .input {
        border-width: 1px;
        border-color: var(--card);
        border-radius: 8px;
        padding: 8px;
        color: var(--text-strong);
      }
      .input:focus {
        border-color: var(--success);
      }

      /* ---- units ---- */
      .u-px {
        width: 40px;
      }
      .u-rem {
        width: 2.5rem;
      }
      .u-pct {
        width: 25%;
      }
      .u-em {
        font-size: 16px;
        width: 3em;
      }
      .u-vw {
        width: 12vw;
      }
      .u-calc {
        width: calc(2rem + 8px);
      }
      .bar {
        height: 12px;
        background-color: #3b6ef5;
        border-radius: 3px;
      }

      /* ---- properties ---- */
      .panel {
        background-color: var(--card);
        border: 2px solid #3b6ef5;
        border-radius: 8px;
        padding: 8px 10px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      }
      .tilted {
        transform: rotate(-6deg) scale(0.95);
      }
      .struck {
        text-decoration: line-through solid;
        text-decoration-color: var(--danger);
      }
      .fonted {
        font: bold 16px/1.4 system-ui;
      }
      .shadowed-text {
        text-shadow: 0 1px 3px #3b6ef5;
      }
      .logical {
        padding-inline: 12px;
        background-color: var(--card);
      }
    `,
  ],
  template: `
    <!-- SELECTORS -->
    <view class="section sel">
      <text class="section-title">Selectors</text>
      <text nativeID="by-id">id selector: green</text>
      <text class="descendant">descendant: green</text>
      <text class="child">child (direct): green</text>
      <view class="nested"><text class="descendant-only">nested descendant: red</text></view>
      <text data-flag="yes">attribute present: green</text>
      <text data-kind="alpha">attribute equals: green</text>
      <text data-kind="beta">attribute prefix: green</text>
      <text class="pick one">:is(.one, .two): green and italic</text>
      <text class="pick three">:not(.one, .two): red</text>
      <text class="cap">a red line above means that selector matched correctly</text>
    </view>

    <!-- CASCADE -->
    <view class="section">
      <text class="section-title">Cascade</text>
      <text class="cascade wins">specificity: two classes beat one, green</text>
      <text class="later">source order: the later rule wins, green</text>
      <text class="shout shout-loser">!important beats a later rule, green</text>
    </view>

    <!-- INHERITANCE -->
    <view class="section inherits">
      <text class="section-title">Inheritance</text>
      <text>this text sets no colour of its own and is green</text>
      <text class="cap">letter-spacing and font-size come down the tree too</text>
    </view>

    <!-- TOKENS -->
    <view class="section">
      <text class="section-title">Tokens (var)</text>
      <view class="row">
        <view class="token-swatch"></view>
        <text>--accent from the app's global sheet: blue</text>
      </view>
      <view class="row token-local">
        <view class="token-swatch"></view>
        <text>--accent redefined on this row: green</text>
      </view>
      <text class="token-fallback">var() fallback when undefined: green</text>
    </view>

    <!-- MEDIA -->
    <view class="section">
      <text class="section-title">Media queries</text>
      <text class="media-note">min-width 300px: green on a phone</text>
      <text class="portrait-only">orientation portrait: green upright, grey rotated</text>
      <text class="scheme">prefers-color-scheme dark: green in dark mode</text>
      <text class="cap">rotate the device, or switch appearance, and these change live</text>
    </view>

    <!-- STATE -->
    <view class="section">
      <text class="section-title">Pseudo-state</text>
      <pressable class="press"><text>press and hold me: turns green</text></pressable>
      <text class="off" [disabled]="true">[data-disabled] a disabled text publishes: red</text>
      <text-input
        class="input"
        placeholder="focus me: border turns green"
        placeholderTextColor="#6c6c78"
      />
    </view>

    <!-- UNITS -->
    <view class="section">
      <text class="section-title">Units</text>
      <view class="row"><view class="bar u-px"></view><text class="cap">40px</text></view>
      <view class="row"><view class="bar u-rem"></view><text class="cap">2.5rem = 40</text></view>
      <view class="row"><view class="bar u-em"></view><text class="cap">3em of 16 = 48</text></view>
      <view class="row"
        ><view class="bar u-calc"></view><text class="cap">calc(2rem + 8px) = 40</text></view
      >
      <view class="row"><view class="bar u-vw"></view><text class="cap">12vw</text></view>
      <view class="row"><view class="bar u-pct"></view><text class="cap">25%</text></view>
      <text class="cap">the first, second and fourth bars must be the same length</text>
    </view>

    <!-- PROPERTIES -->
    <view class="section">
      <text class="section-title">Properties</text>
      <view class="row">
        <view class="panel"><text>border + shadow</text></view>
        <view class="panel tilted"><text>transform</text></view>
      </view>
      <text class="struck">text-decoration shorthand</text>
      <text class="fonted">font shorthand</text>
      <text class="shadowed-text">text-shadow</text>
      <view class="logical"><text>padding-inline (logical)</text></view>
    </view>
  `,
})
export class CssDemo {}
