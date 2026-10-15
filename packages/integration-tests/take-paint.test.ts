/**
 * `Engine.takePaint`: a node's background colour handed to a listener instead of painted, for a
 * component whose colour a native view other than the node draws, as a bottom sheet's is.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const CSS =
  '.tinted { --tint: #112233; background-color: var(--tint) } .red { background-color: red }';

function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const node = engine.createElement('view');
  engine.setClasses(node, 'tinted');
  engine.appendChild(engine.root, node);
  const heard: unknown[] = [];
  const painted = () => fabric.committed[0]!.props['backgroundColor'];
  return { engine, node, heard, painted };
}

describe('a node that hands its background colour over', () => {
  it('reports the colour once per change, and leaves it unpainted', () => {
    const { engine, node, heard, painted } = scene();
    engine.takePaint(node, (color) => heard.push(color));
    engine.commit();
    assert.deepEqual(heard, ['rgb(17, 34, 51)']);
    assert.equal(painted(), undefined);

    engine.setProp(node, 'testID', 'moved');
    engine.commit();
    assert.deepEqual(heard, ['rgb(17, 34, 51)'], 'a commit that leaves it alone reports nothing');

    engine.setCustomProperty(node, '--tint', '#445566');
    engine.commit();
    assert.equal(heard.at(-1), '#445566', 'a token it reads changed');

    engine.setClasses(node, '');
    engine.commit();
    assert.equal(heard.at(-1), undefined, 'none once the class is gone');
  });

  it('paints it again, and reports nothing more, once stopped', () => {
    const { engine, node, heard, painted } = scene();
    const stop = engine.takePaint(node, (color) => heard.push(color));
    engine.commit();
    stop();
    engine.setClasses(node, 'red');
    engine.commit();
    assert.deepEqual(heard, ['rgb(17, 34, 51)']);
    assert.notEqual(painted(), undefined);
  });
});
