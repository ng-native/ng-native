/**
 * Code written for the web can read an engine node as an element, with the DOM's members put on
 * the prototype nodes share. A field the engine keeps on the node itself hides a member of the
 * same name, and the DOM cannot have it back: `element.children` would be every child, text
 * included, and `a.host` the engine. So no field of a node is named as a member of a DOM element
 * is, by the DOM TypeScript describes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const source = (path: string) =>
  ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);

/** The names of the members of the declarations `wanted` picks, in a file. */
function membersOf(file: ts.SourceFile, wanted: (name: string) => boolean): Map<string, string> {
  const found = new Map<string, string>();
  file.forEachChild((node) => {
    if (!(ts.isInterfaceDeclaration(node) && wanted(node.name.text))) return;
    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) found.set(member.name.text, node.name.text);
    }
  });
  return found;
}

/** Every member of a DOM node, an element of any kind and the mixins they are made of. */
function domMembers(): Map<string, string> {
  const lib = createRequire(import.meta.url).resolve('typescript/lib/lib.dom.d.ts');
  const element =
    /^(Node|Element|ParentNode|ChildNode|NonDocumentTypeChildNode|Slottable|InnerHTML|Animatable|ARIAMixin|ElementCSSInlineStyle|ElementContentEditable|HTMLOrSVGElement|LinkStyle|HTMLHyperlinkElementUtils|PopoverInvokerElement|SVGTests|SVGURIReference|SVGFitToViewBox|SVGAnimatedPoints|SVGFilterPrimitiveStandardAttributes|CharacterData|Text|(HTML|SVG|MathML)\w*Element)$/;
  return membersOf(source(lib), (name) => element.test(name));
}

/** The fields a node keeps of its own: those it is made with, and those its type says it may. */
function nodeFields(): Set<string> {
  const engine = new Engine(createFakeFabric(), 1);
  const node = engine.createElement('view', null);
  const own = new Set(Object.keys(node));
  const declared = (path: string, names: string[]) =>
    membersOf(source(fileURLToPath(new URL(path, import.meta.url))), (name) =>
      names.includes(name),
    );
  const prototype = Object.getPrototypeOf(node) as object;
  for (const name of [
    ...declared('../fabric/src/engine.ts', ['EngineNode']).keys(),
    ...declared('../fabric/src/host.ts', ['HostNode']).keys(),
  ]) {
    // A getter or a method on the prototype is the DOM's own, and a package may replace it.
    if (!Object.getOwnPropertyDescriptor(prototype, name)) own.add(name);
  }
  return own;
}

describe("an engine node's fields", () => {
  it('have no name a DOM element has a member by', () => {
    const dom = domMembers();
    assert.ok(dom.has('children') && dom.has('host'), 'the DOM is read');
    const clashes = [...nodeFields()]
      .filter((name) => dom.has(name))
      .map((name) => `${name} (${dom.get(name)})`);
    assert.deepEqual(clashes, []);
  });
});
