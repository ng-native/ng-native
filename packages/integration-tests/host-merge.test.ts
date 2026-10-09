/**
 * What happens to a `class` or a `[style]` a caller writes on a component that sets its own.
 *
 * A styled component commonly computes its host `class` from its own state, and binds a host
 * `[style]` too. If either of those *replaced* what the call site wrote, `<x-badge class="mt-4">`
 * would silently lose its margin - and silently is the whole problem, because a class that
 * resolves to nothing looks identical to a class that was never written.
 *
 * These are Angular's own styling semantics rather than anything this project implements, which is
 * exactly why they are worth pinning: the behaviour is inherited, so nothing here would notice if
 * it changed.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, compileCss, render } from '@ng-native/testing';
import type { FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

/**
 * One rule per class, so "did the class survive" is answerable from committed props.
 *
 * A class name is not a committed prop - only the props it resolves to are - so a test that
 * asserted on the class string would be asserting on something the device never sees.
 */
const SHEET = [
  '.caller { border-bottom-width: 2px }',
  // `.loud` is the caller's, and it is declared *before* the component's own `.own` on purpose.
  // Two single-class selectors have equal specificity, so the later rule wins - and a caller that
  // loses that race cannot override anything by writing a class, however clear the intent.
  '.loud { opacity: 1 }',
  '.own { border-top-width: 1px; opacity: 0.5 }',
].join(' ');

describe('a caller styling a component that styles its own host', () => {
  let props: Record<string, Record<string, unknown>>;

  before(async () => {
    const mod = await compileFixture('fixtures/host-merge.ts');
    const { fabric } = await render(mod['HostMerge'] as Type<unknown>, {
      globalStyles: compileCss(SHEET, 'global'),
    });
    // Bulk "every id to its props" read: the query matrix has no query for that, so this keeps a
    // local `flatten` over the whole committed tree for it.
    props = Object.fromEntries(
      flatten(fabric.committed)
        .filter((n) => n.props['nativeID'])
        .map((n) => [String(n.props['nativeID']), n.props]),
    );
  });

  after(cleanup);

  it('keeps both classes when the component folds the input into its own', () => {
    // `class` is an input, and the component folds it in beside its own.
    assert.equal(props['with-input']!['borderTopWidth'], 1, "the component's own class applied");
    assert.equal(props['with-input']!['borderBottomWidth'], 2, "the caller's class applied");
  });

  it("keeps the caller's class even when the component takes no class input", () => {
    /*
     * Angular writes a static `class` attribute onto a component's host *and* passes it to a
     * matching input, as two independent code paths - so a component with no `class` input still
     * gets the attribute, and a `[class]` host binding is merged with it rather than replacing it.
     */
    assert.equal(props['without-input']!['borderTopWidth'], 1, "the component's own class applied");
    assert.equal(props['without-input']!['borderBottomWidth'], 2, "the caller's class applied");
  });

  it("merges a host [style] with the caller's, rather than replacing it", () => {
    // The component's host binding contributes `paddingTop`, the call site contributes `marginTop`,
    // and both have to arrive.
    assert.equal(props['with-input']!['paddingTop'], 3, "the component's own style applied");
    assert.equal(props['with-input']!['marginTop'], 9, "the caller's style applied");
  });

  it("keeps a caller's bound [class] on a component that takes no class input", () => {
    // A static attribute and a `[class]` binding are different code paths in Angular, and only the
    // static one also feeds a matching input. This is the path with nothing else backing it up.
    assert.equal(props['bound-class']!['borderTopWidth'], 1, "the component's own class applied");
    assert.equal(props['bound-class']!['borderBottomWidth'], 2, "the caller's class applied");
  });

  it('lets the call site win where the two name the same property', () => {
    // Angular's precedence: a template binding beats a component's host binding. Anything else
    // would make a component impossible to adjust from outside.
    assert.equal(props['style-conflict']!['paddingTop'], 11);
  });

  /*
   * The one that is not symmetrical.
   *
   * Classes do not have the call-site precedence styles do. Two single-class selectors have equal
   * specificity, so the winner is whichever rule the stylesheet declares last - an order the call
   * site does not control and cannot see. Folding the caller's class into the component's own
   * does not change that: both classes survive into the string, and the cascade decides.
   */
  it('leaves a conflicting class to the stylesheet order, even through a class input', () => {
    // `.own` is declared after `.loud`, so the component wins despite the caller's intent. Only
    // removing the losing class from the string, rather than joining the two, would change this.
    assert.equal(props['conflict-with-input']!['opacity'], 0.5);
  });

  it("leaves a conflicting class to the stylesheet's order without one", () => {
    // Not asserting the caller wins, because it does not: `.own` is declared after `.loud`. This
    // pins the fact rather than the preference.
    assert.equal(props['conflict-no-input']!['opacity'], 0.5, 'the later rule won, not the caller');
  });
});
