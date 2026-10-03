/**
 * Fixture for `browser/html-elements.test.ts`: HTML's text and layout elements in a template, as
 * a web build draws them. See `button-app.ts`'s doc comment for why a real `@Component` has to
 * live in its own file rather than inside a test.
 */
import { Component } from '@angular/core';
import { View } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [View],
  template: `
    <view id="root" style="width: 300px">
      <p id="para">Hello <strong id="strong">big</strong> world</p>
      <span id="badge">Inbox<view id="dot" style="width: 8px; height: 8px"></view></span>
      <p id="outer">
        <span id="holder"><view id="deep" style="height: 4px"></view></span>
      </p>
      <view id="card">Card body<view id="inner" style="height: 10px"></view>After</view>
      <h1 id="heading">Title</h1>
      <ul id="list">
        <li id="item">One</li>
      </ul>
      <p id="sized">a <small id="small">small</small> <code id="code">code</code></p>
      <p><mark id="mark">mark</mark></p>
    </view>
  `,
})
export class HtmlElementsApp {}
