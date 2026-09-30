/**
 * The files a generated component is made of: a component built from `<view>` and `<text>`, and a
 * test that renders it on the fake Fabric. `@ng-native/schematics` and `@ng-native/nx` each ship
 * this file, and a test in `@ng-native/nx` keeps the two identical.
 */

/**
 * @param {string} className
 * @param {string} selector
 * @param {string} label the text it shows, which its test finds
 */
function componentSource(className, selector, label) {
  return `import { Component } from '@angular/core';
import { Text, View } from '@ng-native/components';

@Component({
  selector: '${selector}',
  imports: [Text, View],
  template: \`
    <view>
      <text>${label}</text>
    </view>
  \`,
})
export class ${className} {}
`;
}

/**
 * @param {string} className
 * @param {string} file the component's file name, without `.ts`
 * @param {string} label
 */
function testSource(className, file, label) {
  return `import { render, screen } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { ${className} } from './${file}.ts';

test('renders', async () => {
  await render(${className});

  expect(screen.getByText('${label}')).toBeTruthy();
});
`;
}

module.exports = { componentSource, testSource };
