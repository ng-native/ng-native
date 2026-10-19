/**
 * A `<canvas>` and its 2D context: what is drawn on it is the shapes react-native-svg draws, on
 * the grid the canvas is the size of, drawn again over the shapes it had.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { NgIcon } from '@ng-native/icons';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({ template: `<canvas testID="chart" width="100" height="50"></canvas>` })
class Drawings {}

@Component({
  imports: [NgIcon],
  template: `<ng-icon [svg]="words" />`,
})
class Icon {
  readonly words = '<svg viewBox="0 0 24 24"><text x="1" y="10">Hi</text></svg>';
}

const document = (): Dom => (globalThis as Dom).document;

// First in the file, so the first icon of the process is drawn in it: an icon names the native
// text for its own once, and what draws a text's loose words is the native text's to say.
describe('@ng-native/web-compat canvas text beside an icon', () => {
  it('draws its words by a span after the first icon is drawn', async () => {
    const app = await render(Drawings, { providers: [provideWebCompat()] });
    await render(Icon);
    const context = document().querySelector('canvas').getContext('2d');
    context.fillText('Sales', 0, 20);
    await settle();
    const [text] = app.getByTestId('chart').children[0]!.children;
    assert.deepEqual(
      text!.children.map((words) => [words.viewName, words.props['content']]),
      [['RNSVGTSpan', 'Sales']],
    );
  });
});

describe('@ng-native/web-compat canvas', () => {
  const canvas = async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    await settle();
    const node = document().querySelector('canvas');
    return { node, context: node.getContext('2d') };
  };
  // In the one group the drawing holds: see the next test.
  const shapes = () => screen.getByTestId('chart').children[0]!.children;

  it('is a drawing of the shapes its context was given, on the grid it is the size of', async () => {
    const { node, context } = await canvas();
    assert.equal(context.canvas, node);
    assert.equal(node.getContext('webgl'), null);
    const view = screen.getByTestId('chart');
    assert.equal(view.viewName, 'RNSVGSvgView');
    assert.deepEqual([view.props['vbWidth'], view.props['vbHeight']], [100, 50]);
    assert.deepEqual([view.props['width'], view.props['height']], [100, 50]);
    context.fillStyle = 'red';
    context.fillRect(10, 5, 20, 10);
    await settle();
    const [bar] = shapes();
    assert.equal(bar!.viewName, 'RNSVGPath');
    assert.equal(bar!.props['d'], 'M10 5L30 5L30 15L10 15Z');
    assert.deepEqual(bar!.props['fill'], { type: 0, payload: 'red' });
  });

  it('draws into a group of its own, which Android repaints the drawing for a shape added to', async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    await settle();
    // There before anything is drawn: in the drawing as it is first painted, and not added with
    // the first shape.
    const [made] = screen.getByTestId('chart').children;
    assert.equal(made!.viewName, 'RNSVGGroup');
    const node = document().querySelector('canvas');
    const context = node.getContext('2d');
    context.fillRect(10, 5, 20, 10);
    await settle();
    const [group, ...others] = screen.getByTestId('chart').children;
    assert.equal(group!.viewName, 'RNSVGGroup');
    assert.deepEqual(others, []);
    assert.equal(group!.children[0]!.viewName, 'RNSVGPath');
  });

  it('draws a path where the transform there was puts each point of it', async () => {
    const { context } = await canvas();
    context.save();
    context.translate(10, 10);
    context.scale(2, 2);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(5, 0);
    context.lineWidth = 3;
    context.strokeStyle = 'blue';
    context.stroke();
    context.restore();
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(5, 0);
    context.stroke();
    await settle();
    const [scaled, plain] = shapes();
    // The line is as wide as the transform makes it too.
    assert.deepEqual([scaled!.props['d'], scaled!.props['strokeWidth']], ['M10 10L20 10', '6']);
    assert.deepEqual([plain!.props['d'], plain!.props['strokeWidth']], ['M0 0L5 0', '1']);
    // A transform that makes a stroke as wide every way is not on the shape.
    assert.equal(scaled!.props['matrix'], undefined);
  });

  it('strokes a path where it was given and then transforms it, under a transform that stretches one way more', async () => {
    const { context } = await canvas();
    context.translate(10, 5);
    context.scale(4, 1);
    context.lineWidth = 2;
    context.setLineDash([3, 1]);
    context.strokeRect(0, 0, 5, 5);
    await settle();
    const [box] = shapes();
    // As Chrome draws it: 8 wide along x and 2 down y, which no one width on the grid is.
    assert.deepEqual(
      ['d', 'matrix', 'strokeWidth', 'strokeDasharray'].map((key) => box!.props[key]),
      ['M0 0L5 0L5 5L0 5Z', [4, 0, 0, 1, 10, 5], '2', ['3', '1']],
    );
  });

  it('strokes a path under a skew in the space of the transform there is when it is stroked', async () => {
    const { context } = await canvas();
    context.moveTo(4, 0);
    context.transform(2, 0, 0.5, 1, 0, 0);
    context.lineTo(1, 10);
    context.lineWidth = 3;
    context.stroke();
    await settle();
    const [line] = shapes();
    // The point given before the skew is where the skew puts the canvas's 4, 0.
    assert.deepEqual(
      ['d', 'matrix', 'strokeWidth'].map((key) => line!.props[key]),
      ['M2 0L1 10', [2, 0, 0.5, 1, 0, 0], '3'],
    );
  });

  it('runs the gradient a stretched stroke is drawn with in the space it is stroked in', async () => {
    const { context } = await canvas();
    const fade = context.createLinearGradient(0, 0, 10, 0);
    fade.addColorStop(0, 'red');
    fade.addColorStop(1, 'blue');
    context.scale(4, 1);
    context.strokeStyle = fade;
    context.strokeRect(0, 0, 10, 10);
    await settle();
    const [gradient, box] = shapes();
    assert.deepEqual(
      ['x1', 'y1', 'x2', 'y2'].map((key) => gradient!.props[key]),
      ['0', '0', '10', '0'],
    );
    assert.deepEqual(box!.props['matrix'], [4, 0, 0, 1, 0, 0]);
  });

  it('keeps a clip on the grid of the canvas around a stroke drawn under a transform of its own', async () => {
    const { context } = await canvas();
    context.rect(0, 0, 20, 20);
    context.clip();
    context.scale(4, 1);
    context.strokeRect(1, 1, 2, 2);
    await settle();
    const [defined, clipped] = shapes();
    assert.equal(defined!.children[0]!.children[0]!.props['d'], 'M0 0L20 0L20 20L0 20Z');
    const [box] = clipped!.children;
    assert.equal(clipped!.props['matrix'], undefined);
    assert.deepEqual(
      [box!.props['d'], box!.props['matrix']],
      ['M1 1L3 1L3 3L1 3Z', [4, 0, 0, 1, 0, 0]],
    );
  });

  it('takes the transform off a stroke drawn again over one that had it', async () => {
    const { context } = await canvas();
    context.scale(4, 1);
    context.strokeRect(0, 0, 5, 5);
    await settle();
    const [first] = shapes();
    context.resetTransform();
    context.clearRect(0, 0, 100, 50);
    context.strokeRect(0, 0, 5, 5);
    await settle();
    const [again] = shapes();
    // The same view, moved: not one made afresh.
    assert.equal(again!.reactTag, first!.reactTag);
    // Taken off natively as a prop gone is: set to nothing, which is no transform.
    assert.deepEqual([again!.props['d'], again!.props['matrix']], ['M0 0L5 0L5 5L0 5Z', null]);
  });

  it("strokes a text as wide as the line, which the text's own transform then scales", async () => {
    const { context } = await canvas();
    context.scale(2, 2);
    context.lineWidth = 3;
    const fade = context.createLinearGradient(0, 0, 10, 0);
    fade.addColorStop(0, 'red');
    context.strokeStyle = fade;
    context.strokeText('Sales', 20, 10);
    await settle();
    const [gradient, text] = shapes();
    assert.deepEqual(text!.props['matrix'], [2, 0, 0, 2, 40, 20]);
    assert.equal(text!.props['strokeWidth'], '3');
    // From where the text is drawn: its own 0 is the canvas's 20.
    assert.deepEqual(
      ['x1', 'x2'].map((key) => gradient!.props[key]),
      ['-20', '-10'],
    );
  });

  it('does nothing for a call given what is no number, as a canvas does not', async () => {
    // How a chart leaves a point out of a line: the line goes on from the next one.
    const { context } = await canvas();
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Number.NaN, 5);
    context.lineTo(10, 10);
    context.arc(Number.NaN, 0, 5, 0, 1);
    context.stroke();
    context.fillText('Nowhere', Number.POSITIVE_INFINITY, 0);
    await settle();
    assert.equal(shapes().length, 1);
    assert.equal(shapes()[0]!.props['d'], 'M0 0L10 10');
  });

  it("holds nothing a script sees, as a browser's canvas holds nothing", async () => {
    const { node, context } = await canvas();
    context.fillRect(0, 0, 5, 5);
    await settle();
    assert.equal(node.childNodes.length, 0);
    assert.ok(node.outerHTML.endsWith('></canvas>'), node.outerHTML);
    assert.equal(node.innerHTML, '');
    // And it draws as it did once a script writes markup in it, as a fallback is written.
    node.innerHTML = '<p>No canvas</p>';
    context.fillRect(10, 10, 5, 5);
    await settle();
    assert.equal(shapes().length, 2);
  });

  it('draws a text where it is asked, set against that place as it is aligned', async () => {
    const { context } = await canvas();
    context.font = 'bold 12px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Sales', 50, 20);
    await settle();
    const [text] = shapes();
    assert.equal(text!.viewName, 'RNSVGText');
    assert.deepEqual(text!.props['matrix'], [1, 0, 0, 1, 50, 20]);
    assert.deepEqual(text!.props['font'], {
      textAnchor: 'middle',
      fontSize: '12',
      fontWeight: 'bold',
    });
    assert.equal(text!.children[0]!.props['content'], 'Sales');
    // Wider for more letters, and for a larger font: what a library sets a label's place by.
    const wide = (words: string) => context.measureText(words).width;
    assert.ok(wide('Sales and more') > wide('Sales'));
    context.font = '24px sans-serif';
    assert.ok(wide('Sales') > 40);
    // Measured from the baseline asked, as Chrome measures: a text set by its top rises nothing
    // above it, and one set by its bottom falls nothing below it.
    context.textBaseline = 'top';
    assert.ok(context.measureText('Sales').actualBoundingBoxAscent <= 0);
    assert.ok(context.measureText('Sales').actualBoundingBoxDescent > 20);
    context.textBaseline = 'bottom';
    assert.ok(Math.abs(context.measureText('Sales').fontBoundingBoxDescent) < 1);
    context.textBaseline = 'alphabetic';
    // A weight after a style, as Chart.js writes a font: `normal bold 12px`.
    // A size in another unit is the points it is, as Chrome measures one.
    context.font = '12pt sans-serif';
    const points = context.measureText('Sales').width;
    context.font = '16px sans-serif';
    assert.equal(points, context.measureText('Sales').width);
    context.font = 'normal bold 12px sans-serif';
    context.fillText('Sales', 50, 40);
    await settle();
    assert.equal((shapes()[1]!.props['font'] as { fontWeight?: string }).fontWeight, 'bold');
  });

  it('is a new drawing once it is cleared, and once it is another size', async () => {
    const { node, context } = await canvas();
    context.fillRect(0, 0, 10, 10);
    context.fillRect(20, 0, 10, 10);
    await settle();
    assert.equal(shapes().length, 2);
    // A clear of part of it is not one: see `canvas.ts`.
    context.clearRect(0, 0, 10, 10);
    await settle();
    assert.equal(shapes().length, 2);
    context.clearRect(0, 0, 100, 50);
    context.fillRect(0, 0, 5, 5);
    await settle();
    assert.equal(shapes().length, 1);
    node.width = 200;
    await settle();
    assert.equal(shapes().length, 0);
    assert.equal(screen.getByTestId('chart').props['vbWidth'], 200);
    assert.equal(node.width, 200);
  });

  it('is drawn again over the shapes it had, which move and are not made again', async () => {
    // A frame of an animation: the same shapes, each a little further on.
    const { context } = await canvas();
    const frame = (wide: number, words: string) => {
      context.clearRect(0, 0, 100, 50);
      context.fillRect(0, 0, wide, 10);
      context.fillText(words, 0, 30);
    };
    frame(10, 'One');
    await settle();
    const tags = () => shapes().map((shape) => shape.reactTag);
    const first = tags();
    frame(20, 'Two');
    await settle();
    assert.deepEqual(tags(), first);
    assert.equal(shapes()[0]!.props['d'], 'M0 0L20 0L20 10L0 10Z');
    assert.equal(shapes()[1]!.children[0]!.props['content'], 'Two');
    // One shape fewer, and another kind where a kind was: what is left over goes, and from
    // the first that differs they are made afresh.
    context.clearRect(0, 0, 100, 50);
    context.fillText('Three', 0, 30);
    await settle();
    assert.equal(shapes().length, 1);
    assert.equal(shapes()[0]!.viewName, 'RNSVGText');
    assert.notEqual(shapes()[0]!.reactTag, first[0]);
  });

  it('fills a shape with a gradient, which is drawn as one the shape names', async () => {
    const { context } = await canvas();
    const fade = context.createLinearGradient(0, 0, 0, 50);
    // What a library tells a gradient from a colour by, before it eases one colour to another.
    assert.equal(String(fade), '[object CanvasGradient]');
    fade.addColorStop(1, 'blue');
    fade.addColorStop(0, 'red');
    context.fillStyle = fade;
    context.fillRect(0, 0, 100, 50);
    await settle();
    const [gradient, filled] = shapes();
    assert.equal(gradient!.viewName, 'RNSVGLinearGradient');
    assert.deepEqual(
      ['x1', 'y1', 'x2', 'y2', 'gradientUnits'].map((key) => gradient!.props[key]),
      ['0', '0', '0', '50', 1],
    );
    // In the order they come along it, whatever order they were given in.
    assert.deepEqual(gradient!.props['gradient'], [0, 'red', 1, 'blue']);
    assert.deepEqual(filled!.props['fill'], { type: 1, brushRef: gradient!.props['name'] });
    // A radial one with an inner circle starts at its edge, as the pixels read back do.
    const ring = context.createRadialGradient(50, 25, 10, 50, 25, 20);
    ring.addColorStop(0, 'red');
    ring.addColorStop(1, 'blue');
    context.fillStyle = ring;
    context.fillRect(0, 0, 100, 50);
    await settle();
    const drawn = shapes().find((shape) => shape.viewName === 'RNSVGRadialGradient');
    assert.deepEqual(drawn!.props['gradient'], [0.5, 'red', 1, 'blue']);
    // One with no colours fills nothing, as a canvas has it.
    context.clearRect(0, 0, 100, 50);
    context.fillStyle = context.createRadialGradient(50, 25, 0, 50, 25, 20);
    context.fillRect(0, 0, 100, 50);
    await settle();
    assert.equal(shapes().length, 1);
    // A fill it says it has, of none: one it did not say it had is the black a group fills with.
    assert.deepEqual(shapes()[0]!.props['propList'], ['fill']);
    assert.equal('fill' in shapes()[0]!.props, false);
  });

  it('draws what is clipped under what it was clipped by', async () => {
    const { context } = await canvas();
    context.save();
    context.beginPath();
    context.rect(0, 0, 50, 50);
    context.clip();
    context.fillRect(0, 0, 100, 50);
    context.restore();
    // Short of the bottom: one over all of it is a new drawing, see the test of an opaque fill.
    context.fillRect(0, 0, 100, 40);
    await settle();
    const [defined, clipped, free] = shapes();
    // Inside a definition: Android warns on every draw of a clip path outside one.
    assert.equal(defined!.viewName, 'RNSVGDefs');
    const clip = defined!.children[0];
    assert.equal(clip!.viewName, 'RNSVGClipPath');
    assert.equal(clip!.children[0]!.props['d'], 'M0 0L50 0L50 50L0 50Z');
    // By a group around it, which is on the canvas's grid whatever moves the shape in it.
    assert.equal(clipped!.viewName, 'RNSVGGroup');
    assert.equal(clipped!.props['clipPath'], clip!.props['name']);
    assert.equal(clipped!.children[0]!.viewName, 'RNSVGPath');
    assert.equal(free!.viewName, 'RNSVGPath');
  });

  it('fills and clips by the rule each was given, where native and a browser read it', async () => {
    const { context } = await canvas();
    const ring = () => {
      context.beginPath();
      context.rect(0, 0, 40, 40);
      context.rect(10, 10, 20, 20);
    };
    ring();
    context.fill('evenodd');
    context.fill();
    context.save();
    context.clip('evenodd');
    context.fillRect(0, 0, 100, 50);
    context.restore();
    context.save();
    ring();
    context.clip();
    context.fillRect(0, 0, 100, 40);
    await settle();
    const [odd, nonzero, oddDefined, oddClipped, defined, clipped] = shapes();
    // 0 is even-odd and 1 non-zero; a path's fill is non-zero with none said.
    assert.equal(odd!.props['fillRule'], 0);
    assert.equal(nonzero!.props['fillRule'], undefined);
    // Native reads the rule on what is clipped, and is even-odd with none said; a browser reads
    // it on the clip's path.
    assert.equal(oddClipped!.props['clipRule'], 0);
    assert.equal(oddDefined!.children[0]!.children[0]!.props['clipRule'], 0);
    assert.equal(clipped!.props['clipRule'], 1);
    assert.equal(defined!.children[0]!.children[0]!.props['clipRule'], 1);
  });

  it('runs a gradient under the transform it is filled under, not the one it was made under', async () => {
    const { context } = await canvas();
    const fade = context.createLinearGradient(0, 0, 10, 0);
    fade.addColorStop(0, 'red');
    fade.addColorStop(1, 'blue');
    const ring = context.createRadialGradient(5, 5, 0, 5, 5, 10);
    ring.addColorStop(0, 'red');
    context.translate(50, 0);
    context.fillStyle = fade;
    context.fillRect(0, 0, 10, 10);
    context.setTransform(2, 0, 0, 2, 10, 0);
    context.fillStyle = ring;
    context.fillRect(0, 0, 10, 10);
    await settle();
    const [linear, , radial] = shapes();
    // As Chrome draws it, and as the pixels read back are: from 50 to 60, where the box is.
    assert.deepEqual(
      ['x1', 'y1', 'x2', 'y2'].map((key) => linear!.props[key]),
      ['50', '0', '60', '0'],
    );
    assert.deepEqual(
      ['fx', 'fy', 'cx', 'cy', 'rx', 'ry'].map((key) => radial!.props[key]),
      ['20', '10', '20', '10', '20', '20'],
    );
  });

  it('draws a gradient with the colours it had when it was filled with', async () => {
    const { context } = await canvas();
    const fade = context.createLinearGradient(0, 0, 100, 0);
    fade.addColorStop(0, 'red');
    fade.addColorStop(1, 'blue');
    context.fillStyle = fade;
    context.fillRect(0, 0, 100, 50);
    // Before what is drawn is shown: a colour added after is not on the shape drawn before it.
    fade.addColorStop(0.5, 'lime');
    await settle();
    assert.deepEqual(shapes()[0]!.props['gradient'], [0, 'red', 1, 'blue']);
  });

  it('draws nothing under a clip of no path, as Chrome draws nothing', async () => {
    const { context } = await canvas();
    context.save();
    context.beginPath();
    context.clip();
    context.fillRect(0, 0, 100, 50);
    context.fillText('Hidden', 0, 20);
    // A clip inside one of nothing is nothing too.
    context.rect(0, 0, 50, 50);
    context.clip();
    context.fillRect(0, 0, 100, 50);
    await settle();
    assert.deepEqual(shapes(), []);
    assert.deepEqual([...context.getImageData(5, 5, 1, 1).data], [0, 0, 0, 0]);
    context.restore();
    context.fillRect(0, 0, 10, 10);
    await settle();
    assert.equal(shapes().length, 1);
  });

  it('is a new drawing once an opaque fill covers all of it, and not where anything shows through', async () => {
    // A frame of an animation that paints its background rather than clearing.
    const { context } = await canvas();
    const frame = (wide: number) => {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 100, 50);
      context.fillStyle = 'red';
      context.fillRect(0, 0, wide, 10);
    };
    for (const wide of [10, 20, 30]) frame(wide);
    await settle();
    assert.equal(shapes().length, 2);
    assert.equal(shapes()[1]!.props['d'], 'M0 0L30 0L30 10L0 10Z');
    // Nor is what is read back kept to be replayed: only what this frame drew.
    assert.equal((context as Dom).operations.length, 2);
    assert.deepEqual([...context.getImageData(25, 5, 1, 1).data], [255, 0, 0, 255]);
    // Under the transform, as all of the canvas is covered by what it puts the box at.
    context.setTransform(-1, 0, 0, -1, 100, 50);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 100, 50);
    context.resetTransform();
    await settle();
    assert.equal(shapes().length, 1);
    // Not a fill that lets some through, nor one clipped, nor one short of an edge.
    const kept = (draw: () => void) => {
      context.save();
      draw();
      context.fillRect(0, 0, 100, 50);
      context.restore();
    };
    kept(() => (context.fillStyle = 'rgba(0, 0, 0, 0.5)'));
    kept(() => (context.globalAlpha = 0.5));
    kept(() => (context.globalCompositeOperation = 'multiply'));
    kept(() => (context.fillStyle = context.createLinearGradient(0, 0, 100, 0)));
    kept(() => {
      context.rect(0, 0, 100, 50);
      context.clip();
    });
    kept(() => context.translate(1, 0));
    await settle();
    assert.equal(shapes().length, 8);
  });
});

describe('@ng-native/web-compat canvas, as what it was given changes and goes', () => {
  const canvas = async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    await settle();
    const node = document().querySelector('canvas');
    return { node, context: node.getContext('2d') };
  };
  const view = () => screen.getByTestId('chart');
  const shapes = () => view().children[0]!.children;

  it('is the size an attribute set says, and the size it starts with once that goes', async () => {
    const { node, context } = await canvas();
    context.fillStyle = 'red';
    node.setAttribute('width', '40');
    assert.deepEqual([node.width, node.getAttribute('width')], [40, '40']);
    // A property set is the whole number it reads as, as a browser reflects it.
    node.width = 40.7;
    assert.deepEqual([node.width, node.getAttribute('width')], [40, '40']);
    await settle();
    assert.equal(view().props['vbWidth'], 40);
    // A canvas sized again is a new one: its context is as a new one's.
    assert.equal(context.fillStyle, '#000000');
    node.removeAttribute('width');
    assert.deepEqual([node.width, node.height, node.getAttribute('width')], [300, 50, null]);
    await settle();
    assert.equal(view().props['vbWidth'], 300);
    assert.equal(context.getImageData(0, 0, 300, 1).data.length, 1200);
  });

  it('is sized by a property set as a number is, as a browser converts one', async () => {
    const { node } = await canvas();
    node.width = '50px';
    assert.deepEqual([node.width, node.getAttribute('width')], [0, '0']);
    node.width = '1e2';
    assert.equal(node.width, 100);
    // One past what an attribute holds is the size it has with nothing said.
    node.width = -5;
    assert.equal(node.width, 300);
    // An attribute is read as one is written, in digits from the start.
    node.setAttribute('height', '40px');
    assert.equal(node.height, 40);
  });

  it('has as attributes only what it was given, and not the view box it is drawn by', async () => {
    const { node } = await canvas();
    assert.deepEqual(node.getAttributeNames(), ['width', 'height']);
    // Each where it was, sized again, as Chrome keeps an attribute set again in its place.
    node.width = 50;
    node.setAttribute('width', '60');
    assert.deepEqual(node.getAttributeNames(), ['width', 'height']);
    assert.equal(node.getAttribute('align'), null);
    assert.ok(!node.outerHTML.includes('align'), node.outerHTML);
    const made = document().createElement('canvas');
    made.getContext('2d');
    assert.deepEqual(made.getAttributeNames(), []);
  });

  it('holds nothing a selector finds, nor a direction is read from', async () => {
    const { node, context } = await canvas();
    context.fillRect(0, 0, 10, 10);
    context.fillText('שלום', 0, 20);
    await settle();
    assert.equal(node.querySelector('*'), null);
    assert.equal(document().querySelectorAll('canvas *').length, 0);
    // The words drawn are not the text before what follows the canvas.
    const parent = node.parentNode;
    parent.setAttribute('dir', 'auto');
    parent.append('Sales');
    assert.ok(parent.matches(':dir(ltr)'));
    // What a script writes in it is found, and is the first thing in it.
    node.innerHTML = '<p>No canvas</p>';
    assert.equal(document().querySelector('canvas > p:first-child')?.textContent, 'No canvas');
  });

  it('keeps what it drew where a script takes out what it holds', async () => {
    const { node, context } = await canvas();
    context.fillRect(0, 0, 10, 10);
    await settle();
    node.textContent = '';
    context.fillRect(20, 0, 10, 10);
    await settle();
    const [layer, ...others] = view().children;
    assert.deepEqual(others, []);
    assert.deepEqual(
      layer!.children.map((shape) => shape.props['d']),
      ['M0 0L10 0L10 10L0 10Z', 'M20 0L30 0L30 10L20 10Z'],
    );
  });

  it('is the same context, and the same drawing, once it is moved', async () => {
    const { node, context } = await canvas();
    context.fillRect(0, 0, 10, 10);
    await settle();
    const parent = node.parentNode;
    node.remove();
    parent.append(node);
    await settle();
    assert.equal(node.getContext('2d'), context);
    assert.equal(shapes().length, 1);
    assert.deepEqual([...context.getImageData(5, 5, 1, 1).data], [0, 0, 0, 255]);
  });

  it('is a picture of what it holds now: another once it is drawn on, and none once cleared', async () => {
    const { node, context } = await canvas();
    const blank = node.toDataURL();
    context.fillRect(0, 0, 10, 10);
    const drawn = node.toDataURL();
    assert.notEqual(drawn, blank);
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    assert.notEqual(node.toDataURL(), drawn);
    context.clearRect(0, 0, 100, 50);
    assert.equal(node.toDataURL(), blank);
    const red = context.createImageData(1, 1);
    red.data.set([255, 0, 0, 255]);
    context.putImageData(red, 0, 0);
    assert.notEqual(node.toDataURL(), blank);
  });
});

describe('@ng-native/web-compat canvas a script makes', () => {
  it('draws on the grid a canvas has with nothing said, once it is asked for a context', async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    const made = document().createElement('canvas');
    made.setAttribute('testID', 'made');
    document().querySelector('canvas').parentNode.append(made);
    made.getContext('2d').fillRect(0, 0, 5, 5);
    await settle();
    const view = screen.getByTestId('made');
    assert.deepEqual([view.props['vbWidth'], view.props['vbHeight']], [300, 150]);
    assert.equal(view.children[0]!.children[0]!.viewName, 'RNSVGPath');
  });

  it('draws on a copy of a canvas, which has a group of its own', async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    const node = document().querySelector('canvas');
    const copy = node.cloneNode(false);
    copy.setAttribute('testID', 'copy');
    node.parentNode.append(copy);
    copy.getContext('2d').fillRect(0, 0, 5, 5);
    await settle();
    const [group, ...others] = screen.getByTestId('copy').children;
    assert.deepEqual(others, []);
    assert.equal(group!.children[0]!.viewName, 'RNSVGPath');
    assert.deepEqual(screen.getByTestId('chart').children[0]!.children, []);
  });

  it('is the size of what it is a copy of', async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    const copy = document().querySelector('canvas').cloneNode(false);
    assert.deepEqual([copy.width, copy.height, copy.getAttribute('width')], [100, 50, '100']);
    assert.equal(copy.getContext('2d').getImageData(0, 0, 100, 50).width, 100);
  });

  it('is the size it has with nothing said, as what it is a copy of is', async () => {
    await render(Drawings, { providers: [provideWebCompat()] });
    const made = document().createElement('canvas');
    made.getContext('2d').fillRect(0, 0, 5, 5);
    const copy = made.cloneNode(false);
    assert.deepEqual(copy.defaultStyle, { width: 300, height: 150 });
    assert.deepEqual([copy.props['vbWidth'], copy.props['vbHeight']], [300, 150]);
    // And one never drawn on is no size until it is, as what it is a copy of is not.
    assert.equal(document().createElement('canvas').cloneNode(false).defaultStyle, undefined);
  });
});
