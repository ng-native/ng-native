import { Component, inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

export const session = { signedIn: false };

@Component({ selector: 'x-guarded-a', imports: [Text], template: `<text>A</text>` })
export class GuardedA {}

@Component({ selector: 'x-guarded-b', imports: [Text], template: `<text>B</text>` })
export class GuardedB {}

@Component({ selector: 'x-guarded-home', imports: [Text], template: `<text>Home</text>` })
export class GuardedHome {}

@Component({ selector: 'x-guarded-login', imports: [Text], template: `<text>Login</text>` })
export class GuardedLogin {}

@Component({
  selector: 'x-guarded-shell',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
export class GuardedShell {}

export const guardedRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'a' },
  { path: 'a', component: GuardedA },
  { path: 'b', component: GuardedB },
  { path: 'login', component: GuardedLogin },
  {
    path: 'home',
    component: GuardedHome,
    canActivate: [() => session.signedIn || inject(Router).parseUrl('/login')],
  },
  {
    path: 'account',
    component: GuardedHome,
    canActivate: [() => session.signedIn || inject(Router).parseUrl('/login?next=account')],
  },
  { path: 'sign-in', redirectTo: 'login' },
];
