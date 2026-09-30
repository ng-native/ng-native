/**
 * The pages the Testing the router page uses, for `router-follow-link.test.ts` to run its deep-link
 * example as written.
 */
import { Component } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/index.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({ selector: 'app-home', imports: [Text], template: '<text>Home</text>' })
export class Home {}

@Component({ selector: 'app-about', imports: [Text], template: '<text>We make apps</text>' })
export class About {}

@Component({ selector: 'app-team', imports: [Text], template: '<text>Our team</text>' })
export class Team {}

@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
export class App {}

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'about', component: About },
  { path: 'about/team', component: Team },
];
