/**
 * What `@ng-icons/core` does around an icon, done the same way here: masks, `<use>` and clip
 * paths in the markup, `provideNgIconsConfig`, `provideNgIconLoader`, a colour token, an
 * `aria-label`, and the size an `<ng-icon-stack>` hands its icons.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ErrorHandler, signal, type Type } from '@angular/core';
import { provideNgIconLoader, withCaching } from '@ng-icons/core';
import { of } from 'rxjs';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const views = (id: string) => flatten([screen.getByTestId(id)]);
const viewNames = (id: string) => views(id).map((view) => view.viewName);
const named = (id: string, viewName: string) =>
  views(id).filter((view) => view.viewName === viewName);
const pick = (props: Record<string, unknown>, ...names: string[]) =>
  Object.fromEntries(names.map((name) => [name, props[name]]));

let mod: Record<string, unknown>;

before(async () => {
  mod = await compileFixture('fixtures/icon-parity.ts');
});

describe('an icon with a mask, a use or a clip path', () => {
  before(async () => {
    await render(mod['IconMasks'] as Type<unknown>, {
      processColor: (value) => `processed:${String(value)}`,
    });
  });
  after(cleanup);

  it('draws a duotone line icon through its mask, not as a solid square', () => {
    assert.deepEqual(viewNames('duotone'), [
      'RNSVGSvgView',
      'RNSVGGroup',
      'RNSVGDefs',
      'RNSVGMask',
      'RNSVGGroup',
      'RNSVGCircle',
      'RNSVGPath',
      'RNSVGPath',
    ]);
    const [mask] = named('duotone', 'RNSVGMask');
    assert.deepEqual(
      pick(
        mask!.props,
        'name',
        'x',
        'y',
        'width',
        'height',
        'maskUnits',
        'maskContentUnits',
        'maskType',
      ),
      {
        name: 'ID_PLACEHOLDER_0',
        x: '-10%',
        y: '-10%',
        width: '120%',
        height: '120%',
        maskUnits: 0,
        maskContentUnits: 1,
        maskType: 0,
      },
    );
    const masked = named('duotone', 'RNSVGPath').at(-1)!;
    assert.equal(masked.props['mask'], 'ID_PLACEHOLDER_0');
    assert.ok(!(masked.props['propList'] as string[]).includes('mask'), 'a mask is not inherited');
  });

  it("draws a flag's stars, each a <use> of a path in defs", () => {
    const [star] = named('china', 'RNSVGPath').filter((path) => path.props['name']);
    assert.equal(star!.props['name'], 'ID_PLACEHOLDER_1');
    const uses = named('china', 'RNSVGUse');
    assert.equal(uses.length, 2);
    assert.deepEqual(pick(uses[0]!.props, 'href', 'x', 'y', 'width', 'height'), {
      href: 'ID_PLACEHOLDER_1',
      x: 0,
      y: 0,
      width: '30',
      height: '20',
    });
    assert.deepEqual(uses[0]!.props['matrix'], [76.8, 0, 0, 76.8, 128, 128]);
    assert.deepEqual(
      pick(uses[1]!.props, 'href', 'x', 'width'),
      { href: 'ID_PLACEHOLDER_1', x: '4', width: 0 },
      'href without xlink:, as SVG 2 writes it',
    );
  });

  it("clips a flag's artwork to the clip path it names", () => {
    const [clip] = named('sierra-leone', 'RNSVGClipPath');
    assert.equal(clip!.props['name'], 'ID_PLACEHOLDER_1');
    assert.deepEqual(
      clip!.children.map((child) => child.viewName),
      ['RNSVGRect'],
    );
    const clipped = named('sierra-leone', 'RNSVGGroup').find((group) => group.props['clipPath']);
    assert.equal(clipped?.props['clipPath'], 'ID_PLACEHOLDER_1');
  });
});

describe('an icon under provideNgIconsConfig', () => {
  before(async () => {
    await render(mod['IconConfig'] as Type<unknown>, {
      processColor: (value) => `processed:${String(value)}`,
    });
  });
  after(cleanup);

  it('takes its size, colour and stroke width from the config', () => {
    const icon = screen.getByTestId('configured');
    assert.deepEqual(pick(icon.props, 'width', 'height', 'color'), {
      width: 20,
      height: 20,
      color: 'processed:#123456',
    });
    assert.equal(icon.children[0]!.props['strokeWidth'], '3');
  });

  it('lets its own inputs win over the config', () => {
    const icon = screen.getByTestId('own');
    assert.deepEqual(pick(icon.props, 'width', 'color'), {
      width: 12,
      color: 'processed:#654321',
    });
    assert.equal(icon.children[0]!.props['strokeWidth'], '1');
  });
});

describe('what an icon reads from around it', () => {
  before(async () => {
    await render(mod['IconSurroundings'] as Type<unknown>, {
      processColor: (value) => `processed:${String(value)}`,
    });
  });
  after(cleanup);

  it('resolves a colour written as a token', () => {
    assert.equal(screen.getByTestId('token-colour').props['color'], 'processed:#0a84ff');
  });

  it('is labelled by an aria-label, as on the web', () => {
    assert.deepEqual(
      pick(
        screen.getByTestId('aria').props,
        'accessible',
        'accessibilityRole',
        'accessibilityLabel',
      ),
      { accessible: true, accessibilityRole: 'image', accessibilityLabel: 'Close' },
    );
  });

  it('takes the size an ng-icon-stack sets as --ng-icon__size', () => {
    assert.deepEqual(pick(screen.getByTestId('stacked').props, 'width', 'height'), {
      width: 32,
      height: 32,
    });
  });
});

describe('an icon from provideNgIconLoader', () => {
  /** A loader's answer is a promise, and the redraw it causes lands a pass after it settles. */
  const answered = async () => {
    await settle();
    await settle();
  };
  const markup = (shape: string) => `<svg viewBox="0 0 24 24"><${shape}/></svg>`;
  const calls: string[] = [];
  const errors: unknown[] = [];
  /** Something the loader reads, as a loader that reads a setting would. */
  const setting = signal(0);
  const warnings: string[] = [];
  let finishSlow: (svg: string) => void = () => {};
  let instance: { swapped: { set(value: string): void } };

  before(async () => {
    const loader = (name: string) => {
      calls.push(name);
      setting();
      if (name === 'string-icon') return markup('rect width="1" height="1"');
      if (name === 'observable-icon') return of(markup('ellipse rx="1" ry="1"'));
      if (name === 'slow-icon') return new Promise<string>((resolve) => (finishSlow = resolve));
      if (name === 'empty-icon') return of<string>();
      if (name === 'broken-icon') return Promise.reject(new Error('offline'));
      return Promise.resolve(markup('circle r="1"'));
    };
    const warn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    try {
      ({ instance } = await render<typeof instance>(mod['IconLoader'] as Type<typeof instance>, {
        providers: [
          provideNgIconLoader(loader, withCaching()),
          {
            provide: ErrorHandler,
            useValue: { handleError: (error: unknown) => errors.push(error) },
          },
        ],
      }));
      await answered();
    } finally {
      console.warn = warn;
    }
  });
  after(cleanup);

  it('draws what the loader returns as a string', () => {
    assert.deepEqual(viewNames('string'), ['RNSVGSvgView', 'RNSVGGroup', 'RNSVGRect']);
  });

  it('draws what the loader returns as a promise or an observable', () => {
    assert.deepEqual(viewNames('promise'), ['RNSVGSvgView', 'RNSVGGroup', 'RNSVGCircle']);
    assert.deepEqual(viewNames('observable'), ['RNSVGSvgView', 'RNSVGGroup', 'RNSVGEllipse']);
  });

  it('asks the loader once per name with withCaching', () => {
    assert.deepEqual(viewNames('promise-again'), ['RNSVGSvgView', 'RNSVGGroup', 'RNSVGCircle']);
    assert.equal(calls.filter((name) => name === 'promise-icon').length, 1);
  });

  it('warns when the loader has no icon either, and only then', () => {
    assert.deepEqual(
      warnings.filter((warning) => warning.includes('no icon named')),
      [
        '[angular-native] no icon named empty-icon. Pass it to provideIcons() from the set it ' +
          'belongs to, the same way you would on the web, or load it with provideNgIconLoader().',
      ],
    );
    assert.deepEqual(viewNames('empty'), ['RNSVGSvgView']);
  });

  it('hands a loader that fails to the ErrorHandler', () => {
    assert.deepEqual(
      errors.map((error) => (error as Error).message),
      ['offline'],
    );
  });

  it('ignores an answer for a name the icon no longer has', async () => {
    instance.swapped.set('promise-icon');
    await answered();
    finishSlow(markup('line x2="1"'));
    await answered();
    assert.deepEqual(viewNames('swapped'), ['RNSVGSvgView', 'RNSVGGroup', 'RNSVGCircle']);
  });

  it('asks again for a name whose load failed, rather than caching the failure', async () => {
    instance.swapped.set('broken-icon');
    await answered();
    assert.equal(calls.filter((name) => name === 'broken-icon').length, 2);
  });

  it('does not ask again when a signal the loader read changes', async () => {
    const asked = calls.length;
    setting.set(1);
    await answered();
    assert.equal(calls.length, asked);
  });
});
