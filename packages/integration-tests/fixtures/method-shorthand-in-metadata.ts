import { Component } from '@angular/core';

// A method shorthand inside decorator metadata, which @oxc-angular/vite compiled to invalid
// JavaScript through 0.0.39, with no error reported.
class Token {}

@Component({
  selector: 'app-method-shorthand',
  template: '<view></view>',
  providers: [{ provide: Token, useValue: { attach() {} } }],
})
export class MethodShorthandInMetadata {}
