import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, fireEvent, render, screen, settle, userEvent } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SpartanInputs } from './spartan-inputs.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanInputs, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

const props = (id: string) => screen.getByTestId(id).props;

test('an input is a bordered text field, as wide as its container', async () => {
  await mount();
  expect(screen.getByTestId('name').viewName).toMatch(/TextInput$/);
  expect(props('name')).toMatchObject({
    placeholder: 'Your name',
    width: '100%',
    minWidth: 0,
    height: 36,
    paddingLeft: 10,
    paddingRight: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgb(229, 231, 235)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    fontSize: 16,
    boxShadow: [{ offsetY: 1, blurRadius: 2, color: 'rgba(0, 0, 0, 0.05)' }],
  });
  expect(props('name')['borderTopLeftRadius']).toBeCloseTo(8, 4);
});

// Fails until `::placeholder` reaches an `<input>`: the engine reads it on `<text-input>` alone.
// When it does, this passes and `fails` flags it.
test.fails('its placeholder is the muted colour', async () => {
  await mount();
  expect(props('name')['placeholderTextColor']).toBe('rgb(106, 114, 130)');
});

test('a label is small, medium-weight text on one line', async () => {
  await mount();
  expect(screen.getByTestId('label').viewName).toBe('Paragraph');
  expect(props('label')).toMatchObject({ fontSize: 14, lineHeight: 14, fontWeight: '500' });
});

test('what is typed reaches the page', async () => {
  await mount();
  await userEvent.type(screen.getByTestId('name'), 'Ada');
  expect(screen.getByText('Typed: Ada')).toBeTruthy();
});

test('a type is the keyboard and entry it stands for', async () => {
  await mount();
  expect(props('email')).toMatchObject({ keyboardType: 'email-address', autoCapitalize: 'none' });
  expect(props('password')).toMatchObject({ secureTextEntry: true });
});

test('a disabled input is dimmed and cannot be edited', async () => {
  await mount();
  expect(props('disabled')).toMatchObject({ editable: false, opacity: 0.5, pointerEvents: 'none' });
});

test('a focused input has its ring', async () => {
  await mount();
  await fireEvent(screen.getByTestId('name'), 'topFocus');
  await vi.waitFor(() =>
    expect(props('name')).toMatchObject({
      borderTopColor: 'rgb(153, 161, 175)',
      boxShadow: expect.arrayContaining([
        expect.objectContaining({ spreadDistance: 3, color: 'rgba(153, 161, 175, 0.5)' }),
      ]),
    }),
  );
});

test('each input is named by its label, and a press on the label focuses it', async () => {
  const app = await mount();
  await settle();
  expect(props('name')['accessibilityLabel']).toBe('Name');
  expect(props('email')['accessibilityLabel']).toBe('Email');
  await userEvent.press(screen.getByTestId('label'));
  expect(app.fabric.commands.map((command) => command.name)).toEqual(['focus']);
});
