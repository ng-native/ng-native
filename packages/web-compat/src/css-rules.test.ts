/**
 * Each kind of rule a stylesheet holds, as a script reads it: what it is, what it says, and
 * where it may be. Read from a sheet a script made, as nothing here needs a page.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './index.ts';
import * as cssom from './css-style-sheet.ts';
import { MediaList } from './media-list.ts';
import { cssNamespace } from './css-namespace.ts';

/** What a library sees: loosely typed, as its own code would be. */
type Dom = any;

const { CSSRule, CSSStyleSheet } = cssom;

/** A sheet of some text, as a `<style>` of it would be: `@import` is read in it. */
function sheetOf(text: string): Dom {
  return cssom.sheetOfElement({}, () => text);
}

describe('the kinds of rule', () => {
  it('are each a class of its own, with its number', () => {
    const sheet = sheetOf(`
      @import url("a.css");
      @namespace svg url("http://www.w3.org/2000/svg");
      div { color: green }
      @media screen { div { color: red } }
      @supports (color: green) { div { color: blue } }
      @font-face { font-family: test; src: local("test") }
      @page { margin: 1cm }
      @keyframes test { from { opacity: 0 } to { opacity: 1 } }
      @counter-style thumbs { system: cyclic; symbols: "a" }
      @layer foo { div { color: purple } }
      @layer bar, baz;
      @container card (min-width: 0px) { div { color: orange } }
      @scope (div) to (p) { :scope { color: pink } }
      @property --x { syntax: '<length>'; inherits: false; initial-value: 0px }
      @font-feature-values Font One { @styleset { nice-style: 12 4; } }
      @unknown thing { div { color: red } }
      @charset "utf-8";
    `);
    const kinds = [...sheet.cssRules].map((rule: Dom) => [rule.constructor.name, rule.type]);
    assert.deepEqual(kinds, [
      ['CSSImportRule', 3],
      ['CSSNamespaceRule', 10],
      ['CSSStyleRule', 1],
      ['CSSMediaRule', 4],
      ['CSSSupportsRule', 12],
      ['CSSFontFaceRule', 5],
      ['CSSPageRule', 6],
      ['CSSKeyframesRule', 7],
      ['CSSCounterStyleRule', 11],
      ['CSSLayerBlockRule', 0],
      ['CSSLayerStatementRule', 0],
      ['CSSContainerRule', 0],
      ['CSSScopeRule', 0],
      ['CSSPropertyRule', 0],
      ['CSSFontFeatureValuesRule', 14],
    ]);
    const [
      ,
      namespace,
      ,
      ,
      supports,
      ,
      ,
      frames,
      counter,
      layer,
      layers,
      container,
      scope,
      property,
    ] = sheet.cssRules;
    assert.equal(namespace.prefix, 'svg');
    assert.equal(namespace.cssText, '@namespace svg url("http://www.w3.org/2000/svg");');
    assert.equal(supports.conditionText, '(color: green)');
    assert.equal(frames.cssRules[0].type, CSSRule.KEYFRAME_RULE);
    assert.equal(counter.system, 'cyclic');
    assert.equal(counter.cssText.includes('\n'), false);
    assert.equal(layer.name, 'foo');
    assert.deepEqual([...layers.nameList], ['bar', 'baz']);
    assert.equal(layers.cssText, '@layer bar, baz;');
    assert.equal(container.containerName, 'card');
    assert.equal(container.containerQuery, '(min-width: 0px)');
    assert.equal([scope.start, scope.end].join(), 'div,p');
    assert.deepEqual(
      [property.name, property.syntax, property.inherits],
      ['--x', '"<length>"', false],
    );
    assert.equal(sheet.cssRules[14].styleset.get('nice-style').join(), '12,4');
  });

  it('have what every rule has on the prototype, read only', () => {
    const [rule] = sheetOf('div { color: red }').cssRules;
    for (const name of [
      'type',
      'cssText',
      'parentRule',
      'parentStyleSheet',
      'selectorText',
      'style',
    ]) {
      assert.equal(Object.hasOwn(rule, name), false, name);
      assert.equal(name in rule, true, name);
    }
    assert.equal(Reflect.set(rule, 'type', 9), false);
    assert.equal(rule.type, 1);
    assert.equal(rule.STYLE_RULE, 1);
    assert.equal(CSSRule.FONT_FEATURE_VALUES_RULE, 14);
    assert.equal(Object.prototype.toString.call(rule), '[object CSSStyleRule]');
    assert.equal(Object.prototype.toString.call(cssNamespace), '[object CSS]');
    assert.equal(cssNamespace.escape.length, 1);
    const [face] = sheetOf('@font-face { font-family: a }').cssRules;
    assert.equal(Object.prototype.toString.call(face.style), '[object CSSFontFaceDescriptors]');
  });

  it('are read only where a sheet may have them', () => {
    const rules = (text: string) => [...sheetOf(text).cssRules].map((rule: Dom) => rule.cssText);
    assert.deepEqual(rules('@import;@import supports(display: flex);@namespace;@namespace x;'), []);
    assert.deepEqual(rules('@namespace url(a) b;@namespace x url(a) b;'), []);
    assert.deepEqual(rules('@media all { @import url(a); @namespace url(b); p {} }'), [
      '@media all {\n  p { }\n}',
    ]);
    assert.deepEqual(rules('p {} @import url(a);'), ['p { }']);
    assert.deepEqual(rules('@layer a; @import url(b);'), ['@layer a;', '@import url("b");']);
  });

  it('are put in a sheet only where they may be', () => {
    const sheet = sheetOf('@namespace svg url(a); @namespace url(b);');
    assert.throws(() => sheet.insertRule('p { color: green }'), { name: 'HierarchyRequestError' });
    assert.throws(() => sheet.insertRule('p {}', undefined), { name: 'HierarchyRequestError' });
    sheet.insertRule('@import url("c");');
    assert.equal(sheet.cssRules.length, 3);
    sheet.insertRule('p {}', 3);
    assert.throws(() => sheet.insertRule('@namespace x url(d);', 3), { name: 'InvalidStateError' });
    assert.throws(() => sheet.deleteRule(1), { name: 'InvalidStateError' });
    assert.throws(() => sheet.insertRule(), TypeError);
    assert.throws(() => sheet.deleteRule(), TypeError);
    const media = sheet.cssRules[3 - 0];
    assert.equal(media.cssText, 'p { }');
    sheet.insertRule('@media print {}', 4);
    assert.throws(() => sheet.cssRules[4].insertRule('@import url(e);'), {
      name: 'HierarchyRequestError',
    });
    assert.throws(() => new CSSStyleSheet().insertRule('@import url(e);'), { name: 'SyntaxError' });
  });

  it('are in no sheet once taken out of one', () => {
    const sheet = sheetOf('@media print { p {} } @keyframes k { 0% {} 50% {} }');
    const [media, frames] = sheet.cssRules;
    const inner = media.cssRules[0];
    const [first, second] = frames.cssRules;
    frames.deleteRule('0%');
    assert.equal(first.parentRule, null);
    assert.equal(first.parentStyleSheet, null);
    assert.equal(second.parentRule, frames);
    sheet.deleteRule(0);
    assert.equal(media.parentStyleSheet, null);
    assert.equal(inner.parentStyleSheet, null);
    assert.equal(inner.parentRule, media);
  });
});

describe('an @import rule', () => {
  it('is its URL, its layer, its condition and its media', () => {
    const sheet = sheetOf(`
      @import url("a.css");
      @import 'b.css' layer(base) supports((display: flex) or (display: block)) screen;
      @import url(c.css) layer all;
      @import url('quote"quote');
    `);
    const [plain, full, layered, quoted] = sheet.cssRules;
    assert.equal(plain.cssText, '@import url("a.css");');
    assert.equal(plain.layerName, null);
    assert.equal(plain.supportsText, null);
    assert.equal(full.href, 'b.css');
    assert.equal(full.layerName, 'base');
    assert.equal(full.supportsText, '(display: flex) or (display: block)');
    assert.equal(full.media.mediaText, 'screen');
    assert.equal(
      full.cssText,
      '@import url("b.css") layer(base) supports((display: flex) or (display: block)) screen;',
    );
    assert.equal(layered.cssText, '@import url("c.css") layer all;');
    assert.equal(quoted.cssText, '@import url("quote\\"quote");');
    full.media = 'print';
    assert.equal(full.media.mediaText, 'print');
    // A layer that is none is media, which is no query.
    const [empty, spaced] = sheetOf(
      '@import "a" layer() screen, print; @import "a" layer(a b) supports(x: y);',
    ).cssRules;
    assert.equal(empty.layerName, null);
    assert.equal(empty.cssText, '@import url("a") not all, print;');
    assert.equal(spaced.cssText, '@import url("a") not all;');
  });

  it('has a sheet of its own, the same each time, with nothing loaded in it', () => {
    const sheet = sheetOf('@import url("https://example.com/a.css") screen;');
    const [rule] = sheet.cssRules;
    const imported = rule.styleSheet;
    assert.equal(imported, rule.styleSheet);
    assert.equal(imported instanceof CSSStyleSheet, true);
    assert.equal(imported.ownerRule, rule);
    assert.equal(imported.parentStyleSheet, sheet);
    assert.equal(imported.ownerNode, null);
    assert.equal(imported.href, 'https://example.com/a.css');
    assert.equal(imported.media, rule.media);
    assert.equal(imported.cssRules.length, 0);
    assert.equal(sheet.cssRules instanceof cssom.CSSRuleList, true);
  });
});

describe('an @page rule', () => {
  it('is for the pages its selector names', () => {
    const [rule] = sheetOf('@page {}').cssRules;
    assert.equal(rule.selectorText, '');
    assert.equal(rule.cssText, '@page { }');
    rule.selectorText = 'named:First:left';
    assert.equal(rule.cssText, '@page named:first:left { }');
    for (const wrong of ['named :first', ':first :left', ':notapagepseudo']) {
      rule.selectorText = wrong;
      assert.equal(rule.selectorText, 'named:first:left', wrong);
    }
  });
});

describe('an @keyframes rule', () => {
  it('is its keyframes, each by the percentages it is for', () => {
    const [rule] = sheetOf(
      '@keyframes foo { from { top: 0px } to { top: 1px } 25%, 75% {} }',
    ).cssRules;
    assert.deepEqual(
      [...rule.cssRules].map((each: Dom) => each.keyText),
      ['0%', '100%', '25%, 75%'],
    );
    assert.equal(rule[1].cssText, '100% { top: 1px; }');
    assert.equal(rule.length, 3);
    rule.cssRules[0].keyText = 'from, to';
    assert.equal(rule.cssRules[0].keyText, '0%, 100%');
    assert.throws(() => (rule.cssRules[0].keyText = 'invalid'), { name: 'SyntaxError' });
    rule.appendRule('50% { top: 2px }');
    rule.appendRule('60% {} 70% {}');
    rule.appendRule('80% {} junk');
    assert.equal(rule.length, 4);
    assert.equal(rule.findRule('50%').cssText, '50% { top: 2px; }');
    assert.equal(rule.findRule('to'), rule.cssRules[1]);
    rule.deleteRule('100%');
    assert.equal(rule.length, 3);
    assert.equal(rule[3], undefined);
    rule.name = 'initial';
    assert.equal(
      rule.cssText.replace(/\s/g, ''),
      '@keyframes"initial"{0%,100%{top:0px;}25%,75%{}50%{top:2px;}}',
    );
  });
});

describe('a media list', () => {
  it('appends one query, takes away each like it, and has each by its place', () => {
    const media: Dom = new MediaList('screen, print, screen');
    assert.equal(media[1], 'print');
    media.appendMedium('a, b');
    assert.equal(media.length, 3);
    media.deleteMedium('SCREEN');
    assert.equal(media.mediaText, 'print');
    assert.equal(media[1], undefined);
    assert.throws(() => media.deleteMedium(), TypeError);
  });
});

describe('a sheet', () => {
  it('reads a block in a selector as part of it, and a comment as a space', () => {
    const rules = (text: string) => [...sheetOf(text).cssRules].map((rule: Dom) => rule.cssText);
    assert.deepEqual(rules("[foo='bar' i {}] { color: red }"), []);
    assert.deepEqual(rules("[foo='bar' {i}] { color: red }"), []);
    assert.deepEqual(rules('[foo/**/i] { color: red }'), []);
    assert.deepEqual(rules('[foo=bar/**/i] { color: red } p { content: "/* kept */" }'), [
      '[foo="bar" i] { color: red; }',
      'p { content: "/* kept */"; }',
    ]);
  });

  it('writes a media query of all and a feature as the feature', () => {
    const [rule] = sheetOf('@media all and (color) {} ').cssRules;
    assert.equal(rule.cssText, '@media (color) {\n}');
    assert.equal(new MediaList('not all and (color)').mediaText, 'not all and (color)');
  });
});
