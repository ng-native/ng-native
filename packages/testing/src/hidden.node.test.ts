/**
 * What a query finds: what someone using the app could see or reach, as React Native Testing
 * Library decides by default. A view marked hidden from accessibility, or one with no opacity
 * that takes no touch, is left out unless the query asks for hidden elements too. An element
 * that is `display: none` has no view, and no query finds it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { cleanup, render, screen } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'x-hidden',
  imports: [Pressable, Text, View],
  template: `
    <view [style]="{ display: 'none' }"><text>Gone</text></view>
    <view [style]="{ opacity: 0 }" pointerEvents="none">
      <pressable accessibilityRole="button"><text>Parked</text></pressable>
    </view>
    <view [style]="{ opacity: 0 }"><text>Faded</text></view>
    <view [accessibilityElementsHidden]="true"><text>Behind a sheet</text></view>
    <view importantForAccessibility="no-hide-descendants"><text>Decoration</text></view>
    <text>Visible</text>
  `,
})
class Hidden {}

describe('hidden elements', () => {
  // React Native Testing Library's default: what nobody can see or reach is not found.
  it('are not found by default', async () => {
    await render(Hidden);
    assert.equal(screen.queryByText('Parked'), null);
    assert.equal(screen.queryByRole('button'), null);
    assert.equal(screen.queryByText('Behind a sheet'), null);
    assert.equal(screen.queryByText('Decoration'), null);
    assert.ok(screen.getByText('Visible'));
    // Unseen, and still pressed: a control that fades in takes its touch all the while.
    assert.ok(screen.getByText('Faded'));
  });

  it('are found when asked for', async () => {
    await render(Hidden);
    assert.ok(screen.getByText('Parked', { includeHiddenElements: true }));
    assert.ok(screen.getByRole('button', { includeHiddenElements: true }));
  });

  it('are not there at all where they are not displayed', async () => {
    await render(Hidden);
    assert.equal(screen.queryByText('Gone', { includeHiddenElements: true }), null);
  });
});
