/**
 * HTML's text and layout elements, laid out by a real browser as the engine lays them out on a
 * device: text when they hold only text, a column like any view when they hold one, and with the
 * few styles of their own the engine gives them and nothing else of a browser's.
 */
import { describe, expect, it } from 'vitest';
import { boot, settle } from './boot.ts';
import { HtmlElementsApp } from '../src/html-elements-app.ts';

describe('HTML elements on the web host', () => {
  const start = async () => {
    const { byId } = boot(HtmlElementsApp);
    await settle();
    const style = (id: string) => getComputedStyle(byId(id));
    const box = (id: string) => byId(id).getBoundingClientRect();
    return { byId, style, box };
  };

  it('flows the text elements inside a paragraph inline', async () => {
    const { style, box } = await start();
    expect(style('strong').display).toBe('inline');
    expect(box('para').height).toBe(box('strong').height);
  });

  it('lays a text element that holds a view out as a column, like a view', async () => {
    const { style, box } = await start();
    expect(style('badge').display).toBe('flex');
    expect(style('badge').flexDirection).toBe('column');
    expect(box('dot').top).toBeGreaterThan(box('badge').top);
  });

  it('lays a text element out as a view when a text element inside it holds one', async () => {
    const { style } = await start();
    expect(style('holder').display).toBe('flex');
    expect(style('outer').display).toBe('flex');
  });

  it('puts text written straight into a view above and below the view beside it', async () => {
    const { box } = await start();
    expect(box('inner').top).toBeGreaterThan(box('card').top);
    expect(box('card').bottom).toBeGreaterThan(box('inner').bottom);
  });

  it('draws a heading and a list as plain as the engine does', async () => {
    const { style } = await start();
    expect(style('heading').fontSize).toBe(style('root').fontSize);
    expect(style('heading').fontWeight).toBe('400');
    expect(style('heading').marginTop).toBe('0px');
    expect(style('para').marginTop).toBe('0px');
    expect(style('list').paddingLeft).toBe('0px');
    expect(style('list').listStyleType).toBe('none');
    expect(style('item').display).not.toBe('list-item');
  });

  it("gives strong, small, code and mark the engine's own styles", async () => {
    const { style } = await start();
    expect(style('strong').fontWeight).toBe('700');
    expect(parseFloat(style('small').fontSize)).toBeCloseTo(
      parseFloat(style('sized').fontSize) * 0.8,
    );
    expect(style('code').fontSize).toBe(style('sized').fontSize);
    expect(style('code').fontFamily).toMatch(/monospace/);
    expect(style('mark').backgroundColor).toBe('rgb(255, 255, 0)');
    expect(style('mark').color).toBe('rgb(0, 0, 0)');
  });
});
