import { Component } from '@angular/core';

/**
 * The app the tests' page is in: nothing of its own, so all a test finds is what it put there.
 * Not drawn either: a browser's page has no app beside its body, and an empty view the size of
 * the window would be what a point anywhere in it hit.
 */
@Component({ selector: 'wpt-page', template: '', host: { style: 'display: none' } })
export class Page {}
