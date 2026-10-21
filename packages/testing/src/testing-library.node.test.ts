/**
 * The whole Testing Library surface under `node --test`, written as an app's test would be: the
 * components are declared here, decorators and all, and everything is imported by package name.
 *
 * What it proves beyond the Vitest suite is the other runner - `--import @ng-native/testing/register`
 * compiling a decorated test file and the packages it imports - and the edges the tutorial has no
 * reason to show: what every query throws, and exactly what each event sends.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, input, output, signal } from '@angular/core';
import { Pressable, ScrollView, Text, TextInput, View } from '@ng-native/components';
import {
  cleanup,
  configure,
  fireEvent,
  render,
  resetToDefaults,
  screen,
  userEvent,
  waitFor,
  waitForElementToBeRemoved,
  within,
  type FakeFabricNode,
} from '@ng-native/testing';
import { ngNative } from '@ng-native/testing/vitest';

afterEach(cleanup);

@Component({
  selector: 'x-list',
  imports: [Pressable, Text, View],
  template: `
    <view testID="list">
      <view nativeID="first" accessibilityRole="listitem" accessibilityLabel="First item">
        <text>Apples</text>
      </view>
      <view testID="second" accessibilityRole="listitem">
        <text>Pears</text>
        <text>and <text>plums</text></text>
      </view>
      @if (shown()) {
        <text>Going soon</text>
      }
    </view>
  `,
})
class List {
  readonly shown = signal(true);
  label = 'plain';
}

@Component({
  selector: 'x-items',
  imports: [Text],
  template: `<text>Item 1</text><text>Item 2</text><text>Item 3</text><text>Item 4</text>`,
})
class Items {}

@Component({
  selector: 'x-states',
  imports: [Pressable, Text, View],
  template: `
    <pressable
      testID="save"
      accessibilityRole="button"
      [disabled]="saving()"
      [accessibilityState]="{ busy: saving() }"
    >
      <text>Save</text>
    </pressable>
    <pressable testID="cancel" accessibilityRole="button"><text>Cancel</text></pressable>
    <view testID="tab-a" accessibilityRole="tab" aria-selected="true"><text>A</text></view>
    <view testID="tab-b" accessibilityRole="tab"><text>B</text></view>
    <view testID="agree" accessibilityRole="checkbox" [accessibilityState]="{ checked: 'mixed' }">
      <text>Agree</text>
    </view>
    <view testID="terms" accessibilityRole="checkbox"><text>Terms</text></view>
    <view testID="news" accessibilityRole="checkbox" [accessibilityState]="{ checked: false }">
      <text>News</text>
    </view>
    <pressable testID="pin" accessibilityRole="button" [accessibilityState]="{ checked: true }">
      <text>Pin</text>
    </pressable>
    <view testID="less" accessibilityRole="button" aria-expanded="true"><text>Less</text></view>
    <view testID="more" accessibilityRole="button" aria-expanded="false"><text>More</text></view>
    <text-input testID="locked" accessibilityRole="search" [editable]="false" />
    <text-input testID="open" accessibilityRole="search" />
  `,
})
class States {
  readonly saving = signal(true);
}

describe('queries', () => {
  it('finds by test id, through testID or nativeID', async () => {
    await render(List);
    assert.equal(screen.getByTestId('second').props['testID'], 'second');
    assert.equal(screen.getByTestId('first').props['nativeID'], 'first');
    assert.equal(screen.queryByTestId('third'), null);
  });

  it('finds by role, named by label or by the text inside', async () => {
    await render(List);
    assert.equal(screen.getAllByRole('listitem').length, 2);
    assert.equal(screen.getByRole('listitem', { name: 'First item' }).props['nativeID'], 'first');
    assert.equal(screen.getByRole('listitem', { name: /pears/i }).props['testID'], 'second');
    assert.equal(
      screen.queryByRole('listitem', { name: 'pears', exact: false })?.props['testID'],
      'second',
    );
  });

  it('finds by role in a state, as React Native Testing Library does', async () => {
    await render(States);
    const ids = (nodes: FakeFabricNode[]) => nodes.map((node) => node.props['testID']);
    // A state no one set is false for disabled, selected and busy, and unset for checked and expanded.
    assert.deepEqual(ids(screen.getAllByRole('button', { disabled: true })), ['save']);
    assert.deepEqual(ids(screen.getAllByRole('button', { disabled: false })), [
      'cancel',
      'pin',
      'less',
      'more',
    ]);
    assert.deepEqual(ids(screen.getAllByRole('button', { busy: true })), ['save']);
    assert.deepEqual(ids(screen.getAllByRole('tab', { selected: true })), ['tab-a']);
    assert.deepEqual(ids(screen.getAllByRole('tab', { selected: false })), ['tab-b']);
    assert.deepEqual(ids(screen.getAllByRole('checkbox', { checked: 'mixed' })), ['agree']);
    // Only the checkbox that says it is unchecked: one that says nothing has no checked state.
    assert.deepEqual(ids(screen.getAllByRole('checkbox', { checked: false })), ['news']);
    // A button has no checked state, whatever its accessibilityState says.
    assert.equal(screen.queryByRole('button', { checked: true }), null);
    assert.deepEqual(ids(screen.getAllByRole('button', { expanded: true })), ['less']);
    assert.deepEqual(ids(screen.getAllByRole('button', { expanded: false })), ['more']);
    assert.deepEqual(ids(screen.getAllByRole('search', { disabled: true })), ['locked']);
    assert.deepEqual(ids(screen.getAllByRole('search', { disabled: false })), ['open']);
    assert.equal(screen.queryByRole('button', { name: 'Save', disabled: false }), null);
    assert.throws(
      () => screen.getByRole('button', { name: 'Save', disabled: false }),
      /role "button" and name "Save" and disabled false/,
    );
  });

  it('waits for a role to reach a state', async () => {
    const { instance } = await render(States);
    assert.equal(screen.queryByRole('button', { name: 'Save', disabled: false }), null);
    setTimeout(() => instance.saving.set(false), 20);
    const save = await screen.findByRole('button', { name: 'Save', disabled: false });
    assert.equal(save.props['testID'], 'save');
  });

  it('names a labelled node by its label alone, as a screen reader does', async () => {
    await render(List);
    // "First item" holds the text "Apples", which a screen reader never reads out.
    assert.equal(screen.queryByRole('listitem', { name: 'Apples' }), null);
  });

  it('matches whole text by default, a substring when not exact, and a RegExp as given', async () => {
    await render(List);
    assert.ok(screen.getByText('Apples'));
    assert.equal(screen.queryByText('Apple'), null);
    assert.ok(screen.getByText('apple', { exact: false }));
    assert.ok(screen.getByText(/^and plums$/), 'a nested span is part of its paragraph');
    assert.equal(screen.queryAllByText(/plums/).length, 1, 'and not a match of its own');
    assert.ok(screen.getByText('  Pears '), 'whitespace is normalised on both sides');
  });

  it('finds every match with a global or sticky RegExp, every time', async () => {
    await render(Items);
    assert.equal(screen.getAllByText(/item/gi).length, 4);
    assert.equal(screen.queryAllByText(/Item/y).length, 4);
    const third = /3/g;
    assert.ok(screen.getByText(third));
    assert.ok(screen.getByText(third), 'and again with the same RegExp');
  });

  it('finds by label', async () => {
    await render(List);
    assert.equal(screen.getByLabelText('First item').props['nativeID'], 'first');
    assert.equal(screen.getAllByLabelText(/item/).length, 1);
  });

  it('throws from getBy with the tree when nothing matches', async () => {
    await render(List);
    assert.throws(
      () => screen.getByText('Bananas'),
      (error: Error) =>
        error.message.startsWith('Unable to find a node with text "Bananas".') &&
        error.message.includes('RawText "Apples"') &&
        error.message.includes('View nativeID="first" accessibilityRole="listitem"'),
    );
    assert.throws(() => screen.getAllByText('Bananas'), /Unable to find a node with text/);
  });

  it('throws from getBy and queryBy when more than one matches', async () => {
    await render(List);
    assert.throws(() => screen.getByRole('listitem'), /Found 2 nodes with role "listitem"/);
    assert.throws(() => screen.queryByRole('listitem'), /Use getAllByRole/);
    assert.deepEqual(screen.queryAllByText('Bananas'), []);
  });

  it('scopes a query to a subtree with within', async () => {
    await render(List);
    const second = screen.getByTestId('second');
    assert.ok(within(second).getByText('Pears'));
    assert.equal(within(second).queryByText('Apples'), null);
  });

  it('finds asynchronously, and rejects on timeout', async () => {
    const { instance } = await render(List);
    setTimeout(() => instance.shown.set(false), 20);
    await waitForElementToBeRemoved(() => screen.queryByText('Going soon'));
    await assert.rejects(
      screen.findByText('Going soon', undefined, { timeout: 60, interval: 10 }),
      /Unable to find a node with text "Going soon"/,
    );
    assert.equal((await screen.findAllByRole('listitem')).length, 2);
    assert.equal((await screen.findByTestId('list')).props['testID'], 'list');
  });

  it('waits as long as configure says, unless a call says otherwise', async () => {
    const { instance } = await render(List);
    const hide = async () => {
      instance.shown.set(false);
      await waitForElementToBeRemoved(() => screen.queryByText('Going soon'));
    };
    const show = () => setTimeout(() => instance.shown.set(true), 20);
    await hide();
    try {
      // No time at all: one try, and the node arrives after it.
      configure({ asyncUtilTimeout: 0 });
      show();
      await assert.rejects(screen.findByText('Going soon'), /Unable to find a node/);
      await assert.rejects(
        waitFor(() => screen.getByText('Going soon')),
        /Unable to find a node/,
      );
      assert.ok(await screen.findByText('Going soon', undefined, { timeout: 500 }));

      resetToDefaults();
      await hide();
      show();
      assert.ok(await screen.findByText('Going soon'), 'a second, by default again');
    } finally {
      resetToDefaults();
    }
  });

  it('waits for a held node to go, and refuses one that is already gone', async () => {
    const { instance } = await render(List);
    const going = screen.getByText('Going soon');
    setTimeout(() => instance.shown.set(false), 20);
    await waitForElementToBeRemoved(going);
    await assert.rejects(waitForElementToBeRemoved(going), /already is not/);
    await assert.rejects(
      waitForElementToBeRemoved(() => screen.getByText('Going soon')),
      /already is not/,
    );
  });

  it('gives waitFor the last error once it times out', async () => {
    await render(List);
    await assert.rejects(
      waitFor(() => assert.fail('never'), { timeout: 30, interval: 10 }),
      /never/,
    );
    assert.equal(await waitFor(() => 7), 7);
  });

  it('prints the tree, or one node of it', async () => {
    await render(List);
    const printed: unknown[] = [];
    const log = console.log;
    console.log = (line: unknown) => printed.push(line);
    try {
      screen.debug(screen.getByTestId('second'));
      screen.debug();
    } finally {
      console.log = log;
    }
    assert.match(String(printed[0]), /^View testID="second" accessibilityRole="listitem"/);
    assert.match(String(printed[1]), /^View\n {2}View testID="list"/);
  });
});

@Component({
  selector: 'x-controls',
  imports: [Pressable, ScrollView, Text, TextInput, View],
  template: `
    <view>
      <pressable
        testID="button"
        accessibilityRole="button"
        (press)="log('press')"
        (longPress)="log('longPress')"
      >
        <text>Go</text>
      </pressable>
      <view testID="field-wrapper">
        <text-input
          placeholder="Name"
          [(value)]="name"
          (focus)="log('focus')"
          (blur)="log('blur')"
          (submitEditing)="log('submit')"
          (keyPress)="log('key ' + $event.nativeEvent.key)"
        />
      </view>
      <text-input placeholder="Locked" [editable]="false" [(value)]="locked" />
      <text-input placeholder="Code" [maxLength]="4" [(value)]="code" />
      <scroll-view testID="scroller" (scroll)="log('scroll ' + $event.nativeEvent.contentOffset.y)">
        <text>Content</text>
      </scroll-view>
    </view>
  `,
})
class Controls {
  readonly events: string[] = [];
  readonly name = signal('');
  readonly locked = signal('');
  readonly code = signal('');
  log(event: string): void {
    this.events.push(event);
  }
}

@Component({
  selector: 'x-press-only',
  imports: [Pressable, Text],
  template: `
    <pressable accessibilityRole="button" (press)="presses = presses + 1"
      ><text>Go</text></pressable
    >
  `,
})
class PressOnly {
  presses = 0;
}

@Component({
  selector: 'x-checkout',
  imports: [Pressable, Text, TextInput, View],
  template: `
    <view pointerEvents="none">
      <pressable accessibilityRole="button" (press)="bought = bought + 1"
        ><text>Buy</text></pressable
      >
      <text-input placeholder="Note" [(value)]="note" />
    </view>
    <pressable accessibilityRole="button" pointerEvents="box-none" (press)="saved = saved + 1"
      ><text>Save</text></pressable
    >
    <view pointerEvents="box-only">
      <pressable accessibilityRole="button" (press)="shared = shared + 1"
        ><text>Share</text></pressable
      >
    </view>
    <view pointerEvents="box-none">
      <pressable accessibilityRole="button" (press)="kept = kept + 1"><text>Keep</text></pressable>
    </view>
    <view class="blocked">
      <pressable accessibilityRole="button" (press)="sent = sent + 1"><text>Send</text></pressable>
    </view>
  `,
  styles: `
    .blocked {
      pointer-events: none;
    }
  `,
})
class Checkout {
  bought = 0;
  saved = 0;
  shared = 0;
  kept = 0;
  sent = 0;
  readonly note = signal('');
}

describe('pointerEvents', () => {
  const pressEveryWay = async (name: string): Promise<void> => {
    await userEvent.press(screen.getByRole('button', { name }));
    await userEvent.longPress(screen.getByRole('button', { name }), { duration: 0 });
    await fireEvent.press(screen.getByRole('button', { name }));
    await fireEvent(screen.getByRole('button', { name }), 'press');
  };

  it('does not press a pressable under pointerEvents="none"', async () => {
    const { instance } = await render(Checkout);
    await pressEveryWay('Buy');
    assert.equal(instance.bought, 0);
  });

  it('does not press a pressable that is pointerEvents="box-none" itself', async () => {
    const { instance } = await render(Checkout);
    await pressEveryWay('Save');
    assert.equal(instance.saved, 0);
  });

  it('does not press a pressable under pointerEvents="box-only"', async () => {
    const { instance } = await render(Checkout);
    await pressEveryWay('Share');
    assert.equal(instance.shared, 0);
  });

  it('still presses a pressable under pointerEvents="box-none"', async () => {
    const { instance } = await render(Checkout);
    await pressEveryWay('Keep');
    assert.equal(instance.kept, 4);
  });

  it('does not press a pressable under pointer-events: none from a class', async () => {
    const { instance } = await render(Checkout);
    await pressEveryWay('Send');
    assert.equal(instance.sent, 0);
  });

  it('does not type into or clear a field under pointerEvents="none"', async () => {
    const { instance } = await render(Checkout);
    instance.note.set('Hi');
    await userEvent.type(screen.getByPlaceholderText('Note'), 'x');
    await userEvent.clear(screen.getByPlaceholderText('Note'));
    assert.equal(instance.note(), 'Hi');
  });
});

describe('events', () => {
  const field = (): FakeFabricNode => screen.getByPlaceholderText('Name');

  it('presses through the responder, by fireEvent or by name', async () => {
    const { instance } = await render(Controls);
    await fireEvent.press(screen.getByText('Go'));
    await fireEvent(screen.getByRole('button'), 'press');
    assert.deepEqual(instance.events, ['press', 'press']);
  });

  it('long-presses by holding the touch', async () => {
    const { instance } = await render(Controls);
    await userEvent.longPress(screen.getByRole('button'));
    assert.deepEqual(instance.events, ['longPress']);
    await userEvent.setup().longPress(screen.getByRole('button'), { duration: 0 });
    assert.deepEqual(instance.events, ['longPress', 'press'], 'released at once, it is a press');
  });

  it('still presses after a long hold when nothing listens for a long press', async () => {
    const { instance } = await render(PressOnly);
    await userEvent.longPress(screen.getByRole('button'), { duration: 800 });
    assert.equal(instance.presses, 1);
  });

  it('changes text with the next eventCount, at or under the node given', async () => {
    const { instance, fabric } = await render(Controls);
    await fireEvent.changeText(screen.getByTestId('field-wrapper'), 'Ada');
    await fireEvent(field(), 'changeText', 'Ada L');
    assert.equal(instance.name(), 'Ada L');
    assert.equal(field().props['mostRecentEventCount'], 2);
    assert.ok(screen.getByDisplayValue('Ada L'));
    assert.equal(fabric.commands.length, 0, 'an echo, so no setTextAndSelection');
  });

  it('refuses to change text on something that is not a field', async () => {
    await render(Controls);
    await assert.rejects(fireEvent.changeText(screen.getByTestId('scroller'), 'x'), /No TextInput/);
  });

  it('types a character at a time, then submits and blurs', async () => {
    const { instance } = await render(Controls);
    await userEvent.type(field(), 'Hi', { submitEditing: true });
    assert.equal(instance.name(), 'Hi');
    assert.equal(field().props['mostRecentEventCount'], 2, 'one change per character');
    assert.deepEqual(instance.events, ['focus', 'key H', 'key i', 'submit', 'blur']);
  });

  it('types onto what is already there, and can leave the field focused', async () => {
    const { instance } = await render(Controls);
    instance.name.set('A');
    await userEvent.type(field(), 'b', { skipBlur: true });
    assert.equal(instance.name(), 'Ab');
    assert.deepEqual(instance.events, ['focus', 'key b']);
  });

  it('clears a field', async () => {
    const { instance } = await render(Controls);
    await userEvent.type(field(), 'Ada');
    await userEvent.clear(field());
    assert.equal(instance.name(), '');
    assert.equal(instance.events.at(-1), 'blur');
  });

  it('stops at maxLength, the way native truncates before onChangeText ever fires', async () => {
    const { instance } = await render(Controls);
    await userEvent.type(screen.getByPlaceholderText('Code'), '123456');
    assert.equal(instance.code(), '1234', 'native never calls back with more than maxLength');
  });

  it('leaves a field that is not editable alone', async () => {
    const { instance } = await render(Controls);
    await userEvent.type(screen.getByPlaceholderText('Locked'), 'x');
    await userEvent.clear(screen.getByPlaceholderText('Locked'));
    assert.equal(instance.locked(), '');
  });

  it('focuses, blurs and scrolls', async () => {
    const { instance } = await render(Controls);
    await fireEvent.focus(field());
    await fireEvent.blur(field());
    await fireEvent.scroll(screen.getByTestId('scroller'), {
      nativeEvent: { contentOffset: { x: 0, y: 120 } },
    });
    await fireEvent(screen.getByTestId('scroller'), 'scroll', { contentOffset: { x: 0, y: 5 } });
    assert.deepEqual(instance.events, ['focus', 'blur', 'scroll 120', 'scroll 5']);
  });

  it('fires any other event by name, top prefix or not', async () => {
    const { instance } = await render(Controls);
    await fireEvent(field(), 'submitEditing', { text: 'x' });
    await fireEvent(field(), 'topFocus');
    assert.deepEqual(instance.events, ['submit', 'focus']);
  });
});

@Component({
  selector: 'x-labelled',
  imports: [Text],
  template: '<text>{{ label }} {{ count() }}</text>',
})
class Labelled {
  readonly count = signal(0);
  label = 'Count';
}

@Component({
  selector: 'x-echo',
  imports: [Text],
  template: '<text>{{ word() }}</text>',
})
class Echo {
  readonly word = input.required<string>();
  readonly said = output<string>();
}

describe('render', () => {
  it('sets properties on the instance, then rerenders with new ones', async () => {
    const { rerender, fixture, detectChanges } = await render(Labelled, {
      componentProperties: { label: 'Total' },
    });
    assert.ok(screen.getByText('Total 0'));
    await rerender({ componentProperties: { label: 'Sum' } });
    assert.ok(screen.getByText('Sum 0'));
    fixture.componentInstance.label = 'All';
    await detectChanges();
    assert.ok(screen.getByText('All 0'));
    fixture.componentInstance.count.set(3);
    await fixture.detectChanges();
    assert.ok(screen.getByText('All 3'));
  });

  it('renders a template against the latest render, and unmounts', async () => {
    const first = await render(Labelled);
    const second = await render('<x-labelled /><x-labelled />', { imports: [Labelled] });
    assert.equal(screen.getAllByText('Count 0').length, 2, 'screen is the latest render');
    assert.ok(first.getByText('Count 0'), 'and each render keeps its own queries');
    second.unmount();
    second.unmount();
    assert.ok(screen.getByText('Count 0'), 'the one before it is current again');
  });

  it('sets required inputs before the first pass, listens to outputs, and rerenders inputs', async () => {
    const said: string[] = [];
    const { rerender, instance } = await render(Echo, {
      inputs: { word: 'hello' },
      on: { said: (word: string) => said.push(word) },
    });
    assert.ok(screen.getByText('hello'));
    instance.said.emit('hi');
    await rerender({ inputs: { word: 'bye' } });
    assert.ok(screen.getByText('bye'));
    assert.deepEqual(said, ['hi']);
  });

  it('rejects when a required input is missing', async () => {
    await assert.rejects(render(Echo), /NG0950/);
  });

  it('says so when nothing is rendered', () => {
    cleanup();
    assert.throws(() => screen.getByText('x'), /call render\(\) first/);
  });
});

describe('the Vitest plugin', () => {
  it('adds a library to what Vitest processes itself', () => {
    const plugin = ngNative({ inline: [/\/node_modules\/@my-org\//] });
    const config = (plugin.config as () => { test: { server: { deps: { inline: RegExp[] } } } })();
    assert.ok(
      config.test.server.deps.inline.some((rule) => rule.test('/node_modules/@my-org/x.mjs')),
    );
    assert.ok(
      config.test.server.deps.inline.some((rule) => rule.test('/node_modules/@angular/core/x.mjs')),
    );
  });
});

/** A wrapper with a `placeholder` input of its own, around the one text field it draws. */
@Component({
  selector: 'x-search-field',
  imports: [TextInput],
  template: `<text-input [placeholder]="placeholder()" />`,
})
class SearchField {
  readonly placeholder = input('');
}

@Component({
  selector: 'x-search',
  imports: [SearchField],
  template: `<x-search-field placeholder="Search" />`,
})
class Search {}

@Component({
  selector: 'x-labelled-field',
  imports: [TextInput],
  template: `<text-input [accessibilityLabel]="accessibilityLabel()" [placeholder]="hint()" />`,
})
class LabelledField {
  readonly accessibilityLabel = input<string>();
  readonly hint = input('', { alias: 'placeholder' });
}

@Component({
  selector: 'x-aria-field',
  imports: [TextInput],
  template: `<text-input [accessibilityLabel]="label()" />`,
})
class AriaField {
  readonly label = input('', { alias: 'aria-label' });
}

@Component({
  selector: 'x-aria-form',
  imports: [AriaField],
  template: `<x-aria-field aria-label="Phone" nativeID="phone" />`,
})
class AriaForm {}

@Component({
  selector: 'x-badge',
  imports: [Text],
  template: `<text>new</text>`,
  styles: `
    :host([variant='primary']) {
      background-color: red;
    }
  `,
  host: { '[accessibilityHint]': 'accessibilityHint()' },
})
class Badge {
  readonly variant = input<string>();
  readonly accessibilityHint = input<string>();
}

@Component({
  selector: 'x-badges',
  imports: [Badge],
  template: `<x-badge variant="primary" accessibilityHint="Unread" nativeID="badge" />`,
})
class Badges {}

@Component({
  selector: 'x-labelled-form',
  imports: [LabelledField],
  template: `<x-labelled-field
    accessibilityLabel="Email"
    placeholder="you@example.com"
    nativeID="email"
  />`,
})
class LabelledForm {}

describe('a static attribute that is an input of the host component', () => {
  it('reaches the component and is not committed to its host view as well', async () => {
    await render(LabelledForm);

    assert.match(screen.getByLabelText('Email').viewName, /TextInput/);
    const host = screen.getByTestId('email');
    assert.equal(host.props['accessibilityLabel'], undefined);
    // By the name the template writes, which is the alias and not the property.
    assert.equal(host.props['placeholder'], undefined);
    assert.match(screen.getByPlaceholderText('you@example.com').viewName, /TextInput/);
  });

  it('keeps an aria attribute that is an input off the host view too', async () => {
    // An `aria-label` is mapped to `accessibilityLabel` on the way out, which is a second route
    // to the same second label.
    await render(AriaForm);
    assert.match(screen.getByLabelText('Phone').viewName, /TextInput/);
    assert.equal(screen.getByTestId('phone').props['accessibilityLabel'], undefined);
  });

  it('still matches a selector that reads the attribute on the host', async () => {
    await render(Badges);
    const host = screen.getByTestId('badge');
    assert.equal(host.props['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(host.props['variant'], undefined);
  });

  it('commits what a host binding writes by the same name', async () => {
    await render(Badges);
    assert.equal(screen.getByTestId('badge').props['accessibilityHint'], 'Unread');
  });

  it('still commits an attribute the component has no input for', async () => {
    await render(LabelledForm);
    assert.equal(screen.getByTestId('email').props['nativeID'], 'email');
  });
});

describe('getByPlaceholderText', () => {
  it('finds the text field, not a host view the same attribute was written on', async () => {
    await render(Search);
    const found = screen.getAllByPlaceholderText('Search');
    assert.deepEqual(
      found.map((node) => /TextInput/.test(node.viewName)),
      [true],
    );
  });
});
