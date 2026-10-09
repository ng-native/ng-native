/**
 * A text decoration's colour, for text inside the element that declares the decoration.
 *
 * CSS doesn't inherit `text-decoration`, but a decoration is drawn under the text inside the
 * element that declares it, in that element's decoration colour, or its text colour when it sets
 * none. Text that declares a line of its own draws that one in its own colour. The expected colours
 * were read from Chrome, from the pixels of each line in a screenshot of the same markup.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const GREEN = 'rgb(0, 160, 0)';
const BLUE = 'rgb(0, 0, 255)';
const RED = 'rgb(255, 0, 0)';

/** The colour the line under a text inside a view is drawn in: its own, or the text's colour. */
function line(css: string, inline: Record<string, unknown> | null = null): unknown {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as StyleSheet });
  const view = engine.createElement('view');
  const text = engine.createElement('text');
  engine.setClasses(view, 'outer');
  engine.setClasses(text, 'inner');
  if (inline) engine.setProp(view, 'style', inline);
  engine.appendChild(engine.root, view);
  engine.appendChild(view, text);
  engine.commit();
  const props = fabric.committed[0]!.children[0]!.props;
  return props['textDecorationLine'] === undefined
    ? undefined
    : (props['textDecorationColor'] ?? props['color']);
}

describe('the colour of a text decoration on the text inside', () => {
  it("is the declaring element's decoration colour", () => {
    assert.equal(
      line(
        `.outer { color: ${GREEN}; text-decoration: underline ${RED} } .inner { color: ${BLUE} }`,
      ),
      RED,
    );
  });

  it("is the declaring element's text colour where it sets no decoration colour", () => {
    assert.equal(
      line(`.outer { color: ${GREEN}; text-decoration: underline } .inner { color: ${BLUE} }`),
      GREEN,
    );
    assert.equal(
      line(`.outer { color: ${GREEN}; text-decoration-line: underline } .inner { color: ${BLUE} }`),
      GREEN,
    );
    // An explicit currentColor is the declaring element's colour, not the text's inside it.
    assert.equal(
      line(
        `.outer { color: ${GREEN}; text-decoration: underline currentColor } ` +
          `.inner { color: ${BLUE} }`,
      ),
      GREEN,
    );
    assert.equal(
      line(
        `.outer { color: ${GREEN}; text-decoration-line: underline; ` +
          `text-decoration-color: currentColor } .inner { color: ${BLUE} }`,
      ),
      GREEN,
    );
  });

  it("is the text's own colour where the text declares a line of its own", () => {
    assert.equal(
      line(
        `.outer { color: ${GREEN}; text-decoration: underline ${RED} } ` +
          `.inner { color: ${BLUE}; text-decoration-line: underline }`,
      ),
      BLUE,
    );
  });

  it("ignores the text's own decoration colour where it declares no line", () => {
    assert.equal(
      line(
        `.outer { color: ${GREEN}; text-decoration: underline } ` +
          `.inner { color: ${BLUE}; text-decoration-color: rgb(255, 0, 255) }`,
      ),
      GREEN,
    );
  });

  it("is the declaring element's inline text colour, which beats its rule's", () => {
    assert.equal(
      line(`.outer { color: ${GREEN}; text-decoration: underline } .inner { color: ${BLUE} }`, {
        color: RED,
      }),
      RED,
    );
  });
});
