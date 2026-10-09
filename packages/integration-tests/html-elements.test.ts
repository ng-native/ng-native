/**
 * HTML's text and layout elements in a template: `span`, `p`, `h1` and the rest draw as text, and
 * `div`, `section`, `ul` and the rest as views, with no registration.
 *
 * What a text element commits as is decided by what it holds, as each element is committed: text
 * when it holds only text and other text elements, and a view when it holds anything else, since
 * a box inside a paragraph has no layout. Text written straight into a view is a paragraph of its
 * own, as a run of text in a flex container is a flex item in a browser.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A committed subtree as nested view names, with a text's content in quotes. */
function shape(node: FakeFabricNode): unknown {
  if (node.viewName === 'RawText') return `"${String(node.props['text'])}"`;
  return node.children.length ? { [node.viewName]: node.children.map(shape) } : node.viewName;
}

describe('HTML elements in a template', () => {
  let fabric: FakeFabric;
  let engine: Engine;
  let errors: string[];
  const consoleError = console.error;

  beforeEach(() => {
    fabric = createFakeFabric();
    engine = new Engine(fabric, 1, { dev: true });
    errors = [];
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  });

  afterEach(() => {
    console.error = consoleError;
  });

  /** `tag` holding `children`, where a string is a text node. */
  const el = (tag: string, ...children: (EngineNode | string)[]): EngineNode => {
    const node = engine.createElement(tag);
    for (const child of children) {
      engine.appendChild(node, typeof child === 'string' ? engine.createText(child) : child);
    }
    return node;
  };

  const commit = (node: EngineNode): FakeFabricNode => {
    engine.appendChild(engine.root, node);
    engine.commit();
    return fabric.committed[0]!;
  };

  it('draws a text element with nothing in it as a view, which is a box a stylesheet draws', () => {
    // `<span class="dot"></span>`: a paragraph with no text is no box to size or paint.
    const dot = el('span');
    assert.deepEqual(shape(commit(dot)), 'View');
    const now = () => {
      engine.commit();
      return shape(fabric.committed[0]!);
    };
    // Given text it is a paragraph, and a view again once the text goes.
    const text = engine.createText('Hello');
    engine.appendChild(dot, text);
    assert.deepEqual(now(), { Paragraph: ['"Hello"'] });
    engine.removeChild(dot, text);
    assert.deepEqual(now(), 'View');
  });

  it('draws an empty text element among text as a box beside it, not as a span of it', () => {
    assert.deepEqual(shape(commit(el('p', 'a', el('span'), 'b'))), {
      View: [{ Paragraph: ['"a"'] }, 'View', { Paragraph: ['"b"'] }],
    });
  });

  it('draws a text element that holds only text as a paragraph', () => {
    assert.deepEqual(shape(commit(el('p', 'Hello'))), { Paragraph: ['"Hello"'] });
    assert.deepEqual(errors, []);
  });

  it('flows the text elements inside one inline, as nested text', () => {
    assert.deepEqual(shape(commit(el('p', 'Hello ', el('strong', 'big'), ' world'))), {
      Paragraph: ['"Hello "', { VirtualText: ['"big"'] }, '" world"'],
    });
  });

  it('flows a text element inside a <text>, and a <text> inside a text element', () => {
    assert.deepEqual(shape(commit(el('text', 'a ', el('span', 'b')))), {
      Paragraph: ['"a "', { VirtualText: ['"b"'] }],
    });
  });

  it('draws a text element that holds a view as a view, with its own text in a paragraph', () => {
    assert.deepEqual(shape(commit(el('span', 'Inbox', el('view')))), {
      View: [{ Paragraph: ['"Inbox"'] }, 'View'],
    });
  });

  it('draws a text element as a view when a text element inside it holds a view', () => {
    assert.deepEqual(shape(commit(el('p', el('span', el('view'))))), {
      View: [{ View: ['View'] }],
    });
  });

  it('gives text written straight into a view a paragraph of its own', () => {
    assert.deepEqual(shape(commit(el('view', 'Card body', el('view'), 'After'))), {
      View: [{ Paragraph: ['"Card body"'] }, 'View', { Paragraph: ['"After"'] }],
    });
  });

  it('draws nothing for whitespace between the elements of a view', () => {
    assert.deepEqual(shape(commit(el('view', '\n  ', el('view'), '  '))), { View: ['View'] });
  });

  it('becomes a view when a view is added to it, and text again when the view goes', () => {
    const span = el('span', 'Inbox');
    commit(span);
    assert.deepEqual(shape(fabric.committed[0]!), { Paragraph: ['"Inbox"'] });

    const dot = engine.createElement('view');
    engine.appendChild(span, dot);
    engine.commit();
    assert.deepEqual(shape(fabric.committed[0]!), { View: [{ Paragraph: ['"Inbox"'] }, 'View'] });

    engine.removeChild(span, dot);
    engine.commit();
    assert.deepEqual(shape(fabric.committed[0]!), { Paragraph: ['"Inbox"'] });
  });

  it('follows the text of a paragraph it made, when the text changes', () => {
    const view = engine.createElement('view');
    const text = engine.createText('one');
    engine.appendChild(view, text);
    commit(view);
    const created = fabric.calls.createNode;
    engine.setText(text, 'two');
    engine.commit();
    assert.deepEqual(shape(fabric.committed[0]!), { View: [{ Paragraph: ['"two"'] }] });
    engine.setText(text, 'three');
    engine.commit();
    assert.deepEqual(shape(fabric.committed[0]!), { View: [{ Paragraph: ['"three"'] }] });
    assert.equal(fabric.calls.createNode, created, 'the paragraph is the same view, cloned');
  });

  it('sends a touch on the paragraph it made to the view the text is in', () => {
    const view = engine.createElement('view');
    engine.appendChild(view, engine.createText('Press'));
    const heard: string[] = [];
    engine.setEventListener(view, 'topClick', () => heard.push('view'));
    const paragraph = commit(view).children[0]!;
    fabric.emit(paragraph, 'topClick', {});
    assert.deepEqual(heard, ['view']);
  });

  it("styles the paragraph it made with what the view's text would inherit", () => {
    const sheet = compileCss(
      '.card { color: rgb(1, 2, 3); font-size: 20px; padding: 8px }',
      'card',
    );
    const view = engine.createElement('view', sheet);
    engine.addClass(view, 'card');
    engine.appendChild(view, engine.createText('Card body'));
    const paragraph = commit(view).children[0]!;
    assert.equal(paragraph.props['color'], 'rgb(1, 2, 3)');
    assert.equal(paragraph.props['fontSize'], 20);
    assert.equal(paragraph.props['paddingTop'], undefined, 'and nothing that does not inherit');
  });

  it('matches a rule written against the element name', () => {
    const sheet = compileCss('h1 { font-size: 30px } p.lead { color: rgb(9, 9, 9) }', 'tags');
    const h1 = engine.createElement('h1', sheet);
    engine.appendChild(h1, engine.createText('Title'));
    assert.equal(commit(h1).props['fontSize'], 30);
  });

  it('draws the layout elements as views, with no word about them', () => {
    const tags = ['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'ul', 'ol', 'li'];
    const committed = commit(el('div', ...tags.map((tag) => el(tag))));
    assert.deepEqual(
      committed.children.map((child) => child.viewName),
      tags.map(() => 'View'),
    );
    assert.deepEqual(errors, []);
  });

  it('knows every text element, with no word about them', () => {
    const tags = [
      ...['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'strong', 'b', 'em', 'i'],
      ...['u', 's', 'small', 'code', 'mark', 'abbr', 'cite', 'time'],
    ];
    const committed = commit(el('div', ...tags.map((tag) => el(tag, 'x'))));
    assert.deepEqual(
      committed.children.map((child) => child.viewName),
      tags.map(() => 'Paragraph'),
    );
    assert.deepEqual(errors, []);
  });

  it('wraps loose text in a layout element without asking for a Text import', () => {
    // The paragraph is the engine's own, not a <text> the template wrote without its component.
    assert.deepEqual(shape(commit(el('div', 'loose'))), { View: [{ Paragraph: ['"loose"'] }] });
    assert.deepEqual(errors, []);
  });

  it('still reports an element name it does not know', () => {
    commit(el('div', el('spam', 'x')));
    assert.match(errors.join('\n'), /<spam> is not a known element/);
  });

  describe('a text element that is a flex container aligning its text', () => {
    // An avatar's initials: `<span class="flex size-full items-center justify-center">AH</span>`.
    // A browser makes the text a flex item and centres it. A paragraph's text is its content,
    // which no alignment moves, so the element is a view around a paragraph of the text.
    const CENTRED = '.c { display: flex; align-items: center; justify-content: center }';
    const styled = (css: string, tag = 'span', classes = 'c', ...text: string[]) => {
      const node = engine.createElement(tag, compileCss(css, 'flex'));
      engine.setClasses(node, classes);
      for (const run of text.length ? text : ['AH']) {
        engine.appendChild(node, engine.createText(run));
      }
      return node;
    };

    it('draws as a view around a paragraph of its text, which takes its text styles', () => {
      const span = styled(`${CENTRED} .c { width: 40px; height: 40px; color: rgb(1, 2, 3) }`);
      const committed = commit(span);
      assert.deepEqual(shape(committed), { View: [{ Paragraph: ['"AH"'] }] });
      assert.equal(committed.props['alignItems'], 'center');
      assert.equal(committed.props['justifyContent'], 'center');
      assert.equal(committed.props['width'], 40);
      assert.equal(committed.children[0]!.props['color'], 'rgb(1, 2, 3)');
      assert.equal(committed.children[0]!.props['width'], undefined, 'and not its box');
      assert.deepEqual(errors, []);
    });

    it('has its text laid out again for a face that registers after it was drawn', () => {
      // The element names the family and is no paragraph: the one its text is in has to be reached.
      commit(styled(`${CENTRED} .c { font-family: Inter-600 }`));
      const cap = () => fabric.committed[0]!.children[0]!.props['maxFontSizeMultiplier'];
      const before = cap();
      engine.fontsRegistered(new Set(['Inter-600']));
      assert.notEqual(cap(), before);
    });

    it('stays a paragraph where it aligns nothing, or is not a flex container', () => {
      assert.deepEqual(shape(commit(styled('.c { display: flex }'))), { Paragraph: ['"AH"'] });
      engine = new Engine((fabric = createFakeFabric()), 1);
      assert.deepEqual(shape(commit(styled('.c { align-items: center }'))), {
        Paragraph: ['"AH"'],
      });
    });

    it('is a view around a text element it holds alone, which is its one item', () => {
      // A tab's label: `<span class="content"><span class="label">First</span></span>`, the
      // outer a flex container that centres the inner in the height of the tab.
      const outer = engine.createElement(
        'span',
        compileCss(`${CENTRED} .c { height: 48px }`, 'flex'),
      );
      engine.setClasses(outer, 'c');
      const inner = engine.createElement('span');
      engine.appendChild(inner, engine.createText('First'));
      engine.appendChild(outer, inner);
      const committed = commit(outer);
      assert.deepEqual(shape(committed), { View: [{ Paragraph: ['"First"'] }] });
      assert.equal(committed.props['alignItems'], 'center');
      assert.equal(committed.props['height'], 48);
      assert.equal(committed.children[0]!.props['height'], undefined);
    });

    it('lets the text element it holds place its own text in turn', () => {
      const sheet = compileCss(CENTRED, 'flex');
      const outer = engine.createElement('span', sheet);
      engine.setClasses(outer, 'c');
      const inner = engine.createElement('span', sheet);
      engine.setClasses(inner, 'c');
      engine.appendChild(inner, engine.createText('First'));
      engine.appendChild(outer, inner);
      const committed = commit(outer);
      assert.deepEqual(shape(committed), { View: [{ View: [{ Paragraph: ['"First"'] }] }] });
      assert.equal(committed.children[0]!.props['alignItems'], 'center');
    });

    it('is one paragraph again once it stops centring, and a view once it centres again', () => {
      const outer = engine.createElement('span', compileCss(CENTRED, 'flex'));
      engine.setClasses(outer, 'c');
      const inner = engine.createElement('span');
      engine.appendChild(inner, engine.createText('First'));
      engine.appendChild(outer, inner);
      commit(outer);
      const now = () => {
        engine.commit();
        return shape(fabric.committed[0]!);
      };
      engine.setClasses(outer, '');
      assert.deepEqual(now(), { Paragraph: [{ VirtualText: ['"First"'] }] });
      engine.setClasses(outer, 'c');
      assert.deepEqual(now(), { View: [{ Paragraph: ['"First"'] }] });
    });

    it('leaves a <text> a paragraph, whose own it is to lay out', () => {
      assert.deepEqual(shape(commit(styled(CENTRED, 'text'))), { Paragraph: ['"AH"'] });
    });

    it('leaves one that holds more than a run of text as it was', () => {
      const span = styled(CENTRED, 'span', 'c', 'A', 'H');
      assert.deepEqual(shape(commit(span)), { Paragraph: ['"A"', '"H"'] });
    });

    it('follows the class that aligns it coming and going', () => {
      const span = styled(CENTRED, 'span', '');
      commit(span);
      assert.deepEqual(shape(fabric.committed[0]!), { Paragraph: ['"AH"'] });
      engine.addClass(span, 'c');
      engine.commit();
      assert.deepEqual(shape(fabric.committed[0]!), { View: [{ Paragraph: ['"AH"'] }] });
      engine.removeClass(span, 'c');
      engine.commit();
      assert.deepEqual(shape(fabric.committed[0]!), { Paragraph: ['"AH"'] });
    });

    it('follows an alignment set inline', () => {
      const span = styled('.c { display: flex }');
      commit(span);
      engine.setProp(span, 'style', { justifyContent: 'center' });
      engine.commit();
      assert.deepEqual(shape(fabric.committed[0]!), { View: [{ Paragraph: ['"AH"'] }] });
    });
  });

  describe('with no styles of their own', () => {
    const props = (tag: string) => commit(el(tag, 'x')).props;

    it('draws strong and b bold, em, i and cite italic', () => {
      for (const tag of ['strong', 'b']) {
        engine = new Engine((fabric = createFakeFabric()), 1);
        assert.equal(props(tag)['fontWeight'], '700', tag);
      }
      for (const tag of ['em', 'i', 'cite']) {
        engine = new Engine((fabric = createFakeFabric()), 1);
        assert.equal(props(tag)['fontStyle'], 'italic', tag);
      }
    });

    it('underlines u, strikes s through, and highlights mark', () => {
      assert.equal(props('u')['textDecorationLine'], 'underline');
      engine = new Engine((fabric = createFakeFabric()), 1);
      assert.equal(props('s')['textDecorationLine'], 'line-through');
      engine = new Engine((fabric = createFakeFabric()), 1);
      const mark = props('mark');
      assert.equal(mark['backgroundColor'], 'rgb(255, 255, 0)');
      assert.equal(mark['color'], 'rgb(0, 0, 0)');
    });

    it('draws small at four fifths of the size around it', () => {
      const sheet = compileCss('.box { font-size: 20px }', 'box');
      const p = engine.createElement('p', sheet);
      engine.addClass(p, 'box');
      const small = el('small', 'x');
      engine.appendChild(p, small);
      assert.equal(commit(p).children[0]!.props['fontSize'], 16);
    });

    it('leaves a heading and a paragraph as plain text, with no size, weight or margin', () => {
      for (const tag of ['h1', 'h3', 'p', 'span', 'label']) {
        engine = new Engine((fabric = createFakeFabric()), 1);
        const committed = props(tag);
        for (const key of ['fontSize', 'fontWeight', 'marginTop', 'marginBottom']) {
          assert.equal(committed[key], undefined, `${tag} ${key}`);
        }
      }
    });

    it('announces h1 to h6 as headings', () => {
      for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        engine = new Engine((fabric = createFakeFabric()), 1);
        assert.equal(props(tag)['accessibilityRole'], 'header', tag);
      }
      engine = new Engine((fabric = createFakeFabric()), 1);
      assert.equal(props('p')['accessibilityRole'], undefined);
    });

    it("gives way to a rule of the app's, whatever its specificity", () => {
      const sheet = compileCss('* { font-weight: 400 }', 'app');
      const strong = engine.createElement('strong', sheet);
      engine.appendChild(strong, engine.createText('x'));
      assert.equal(commit(strong).props['fontWeight'], '400');
    });

    it("gives way to a rule of the app's in a cascade layer", () => {
      const sheet = compileCss('@layer base { strong { font-weight: 400 } }', 'layered');
      const strong = engine.createElement('strong', sheet);
      engine.appendChild(strong, engine.createText('x'));
      assert.equal(commit(strong).props['fontWeight'], '400');
    });
  });
});
