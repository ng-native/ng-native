/**
 * What `packages/web/limits.md` says does not carry over to the web, behaving the way it says.
 *
 * Worklets and gestures are native-only. A browser build resolves
 * `@ng-native/components/reanimated` and `/gestures` to inert stand-ins, so a template that uses
 * them still renders, and nothing moves.
 */
import { describe, expect, it } from 'vitest';
import { boot, settle } from './boot.ts';
import { WorkletApp } from '../src/limits-app.ts';

describe('what does not carry over to the web', () => {
  it('renders a template with worklet and gesture directives, which do nothing', async () => {
    const { byId } = boot(WorkletApp);
    await settle();
    expect(byId('label').textContent).toBe('Drag me');
    expect(byId('target').style.transform).toBe('');
  });

  it('lets gesture-root fill its parent, as it does on a device', async () => {
    const { byId } = boot(WorkletApp);
    await settle();
    expect(byId('root').getBoundingClientRect().height).toBe(300);
  });
});
