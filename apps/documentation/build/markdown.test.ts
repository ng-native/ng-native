import { beforeAll, describe, expect, test } from 'vitest';
import { highlight, markdown } from './markdown.ts';

// Load the grammars before the tests compare highlighted output.
beforeAll(async () => {
  await highlight('const value = 1;', 'ts');
}, 30_000);

type Transform = (code: string, id: string) => Promise<{ code: string }>;

/** A page's prose blocks, as the `markdown()` plugin renders them. */
async function render(page: string): Promise<string> {
  const transform = markdown().transform as Transform;
  const { code } = await transform(page, '/repo/apps/documentation/src/content/guide/page.md');
  const blocks = JSON.parse(/^export const blocks = (.*);$/m.exec(code)![1]!) as { html: string }[];
  return blocks.map((block) => block.html).join('');
}

// With TypeScript's grammar an inline template is one string, and with HTML's `@if` is text: a tag
// name or a block keyword on its own is Angular's grammar at work.
describe("TypeScript and HTML, highlighted with Angular's grammars", () => {
  const component = `@Component({\n  selector: 'badge',\n  template: \`<text>{{ label() }}</text>\`,\n})\nexport class Badge {}`;
  const template = `@if (open()) {\n  <text>{{ title() }}</text>\n}`;

  test('in a file', async () => {
    expect(await highlight(component, 'ts')).toContain('>text</span>');
    expect(await highlight(template, 'html')).toContain('>@if</span>');
  });

  test("in a page's code blocks", async () => {
    expect(await render(`\`\`\`ts\n${component}\n\`\`\`\n`)).toContain('>text</span>');
    expect(await render(`\`\`\`html\n${template}\n\`\`\`\n`)).toContain('>@if</span>');
  });
});

describe('the OS support table', () => {
  test('draws a row for each entry of OS_SUPPORT where a page has the marker', async () => {
    const html = await render('# Support\n\n<!-- os-support -->\n\nAfter.\n');
    expect(html).toContain('<th>iPadOS</th>');
    expect(html).toContain('<code>UndoStack</code>');
    expect(html).toContain('list pane from 840dp, a stack below');
    expect(html).not.toContain('os-support');
    expect(html).toContain('After.');
  });
});

describe('the platforms line', () => {
  test('is drawn from the service row where a page has the marker', async () => {
    const html = await render('# Dock\n\n<!-- platforms: Dock -->\n\nAfter.\n');
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
    expect(html).toContain('Absent on Linux, iPadOS, iPhone, Android and Web host');
    expect(html).not.toContain('platforms:');
    expect(html).toContain('After.');
  });

  test('says where a service is on more than one OS, and fails for a service with no row', async () => {
    expect(await render('# Keyboard\n\n<!-- platforms: Keyboard -->\n')).toContain(
      'Available on iPadOS, iPhone and Android.',
    );
    await expect(render('# X\n\n<!-- platforms: Nothing -->\n')).rejects.toThrow(/Nothing/);
  });

  test('names each row when the services in one marker differ, and not when they agree', async () => {
    const html = await render(
      '# Sensors\n\n<!-- platforms: Accelerometer, Gyroscope, LightSensor -->\n',
    );
    expect(html).toContain('<strong>Platforms of <code>Accelerometer</code>');
    expect(html).toContain(
      '<strong>Platforms of <code>LightSensor</code>.</strong> Available on Android.',
    );
    const grouped = await render(
      '# Three\n\n<!-- platforms: AddressSearch, Biometrics, LightSensor -->\n',
    );
    expect(grouped).toContain(
      '<strong>Platforms of <code>AddressSearch</code>, <code>Biometrics</code>.</strong>',
    );
    const same = await render('# Two\n\n<!-- platforms: Accelerometer, Gyroscope -->\n');
    expect(same).toContain('<strong>Platforms.</strong>');
    expect(same.match(/Platforms/g)).toHaveLength(1);
  });

  test('leaves available() out where the service has none', async () => {
    const html = await render('# MapView\n\n<!-- platforms: MapView -->\n');
    expect(html).toContain('Absent on Linux and Web host.');
    expect(html).not.toContain('available()');
  });
});

describe('a marker in a fenced example', () => {
  test('is shown as written, while one outside the fence is drawn', async () => {
    const html = await render(
      '# Markers\n\n```md\n<!-- os-support -->\n<!-- platforms: Nothing -->\n```\n\n<!-- platforms: Dock -->\n',
    );
    expect(html).toContain('os-support');
    expect(html).toContain('platforms: Nothing');
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
  });

  test('ends at a closing fence longer or indented differently from its opener', async () => {
    for (const close of ['````', '  ```', '~~~~~']) {
      const open = close.includes('~') ? '~~~' : '```';
      const html = await render(
        `# Markers\n\n${open}md\n<!-- platforms: Nothing -->\n${close}\n\n<!-- platforms: Dock -->\n`,
      );
      expect(html, close).toContain('<strong>Platforms.</strong> Available on macOS.');
    }
  });

  test('does not close a fence on a run indented four spaces', async () => {
    const html = await render(
      '# Markers\n\n```md\n    ```\n<!-- platforms: Nothing -->\n```\n\n<!-- platforms: Dock -->\n',
    );
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
    expect(html).toContain('platforms: Nothing');
  });

  test('does not close a fence opened one space in on a run indented four spaces', async () => {
    const html = await render(
      '# Markers\n\n ```md\n    ```\n<!-- platforms: Nothing -->\n```\n\n<!-- platforms: Dock -->\n',
    );
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
    expect(html).toContain('platforms: Nothing');
  });

  test('finds a fence a list item indents with a tab', async () => {
    const html = await render(
      '# Markers\n\n- Example:\n\n\t```md\n\t<!-- platforms: Nothing -->\n\t```\n\n<!-- platforms: Dock -->\n',
    );
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
    expect(html).toContain('platforms: Nothing');
  });

  test('takes a tab-indented run outside a list for indented code, not a fence', async () => {
    const html = await render('# Markers\n\n\t```md\n\tliteral\n\n<!-- platforms: Dock -->\n');
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
  });

  test('leaves a marker inside a paragraph as a comment, for a service with a row or none', async () => {
    const html = await render(
      '# Markers\n\nBefore <!-- platforms: Dock -->\n\nAgain <!-- platforms: Nothing -->\n',
    );
    expect(html).not.toContain('Available on macOS');
    expect(html).toContain('<!-- platforms: Dock -->');
  });

  test('keeps a marker in indented code inside a list item', async () => {
    const html = await render(
      '# Markers\n\n- Item:\n\n      <!-- platforms: Nothing -->\n\n<!-- platforms: Dock -->\n',
    );
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
    expect(html).toContain('platforms: Nothing');
  });

  test('takes an indented list marker for code, and keeps the marker after it as code', async () => {
    const html = await render(
      '# Markers\n\n    - not a list\n    <!-- platforms: Nothing -->\n\n<!-- platforms: Dock -->\n',
    );
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
    expect(html).toContain('platforms: Nothing');
  });

  test('closes a fence inside a list item at its own indentation', async () => {
    const html = await render(
      '# Markers\n\n1. A step:\n\n    ```md\n    <!-- platforms: Nothing -->\n    ```\n\n<!-- platforms: Dock -->\n',
    );
    expect(html).toContain('<strong>Platforms.</strong> Available on macOS.');
    expect(html).toContain('platforms: Nothing');
  });
});

describe("a page's contents column", () => {
  /** The headings the `markdown()` plugin collects for a page. */
  async function headings(page: string, name: string): Promise<string[]> {
    const transform = markdown().transform as Transform;
    const { code } = await transform(page, `/repo/apps/documentation/src/content/guide/${name}.md`);
    const list = JSON.parse(/^export const headings = (.*);$/m.exec(code)![1]!) as { id: string }[];
    return list.map((heading) => heading.id);
  }

  // Vite transforms pages concurrently, and the heading-id extension keeps one list and one slugger
  // for the whole process: a parse that yields mid-way picks up the other pages' headings.
  test("holds only that page's headings while other pages render alongside it", async () => {
    const pages = await Promise.all(
      ['one', 'two', 'three'].map((name) =>
        headings(`# Title\n\n## ${name} first\n\nText.\n\n## ${name} second\n\nText.\n`, name),
      ),
    );
    expect(pages).toEqual(
      ['one', 'two', 'three'].map((name) => [`${name}-first`, `${name}-second`]),
    );
  });
});

describe('blog posts', () => {
  const transform = markdown().transform as Transform;
  const post = '---\ntitle: A post\n---\n\nBefore.\n\n<!-- island: coralogix-about -->\n\nAfter.\n';

  test('`?meta` is the front matter alone', async () => {
    const { code } = await transform(post, '/repo/src/blog/posts/a-post.md?meta');
    expect(code).toBe('export const attributes = {"title":"A post"};\n');
  });

  test('an island line is a block of its own in a post', async () => {
    const { code } = await transform(post, '/repo/src/blog/posts/a-post.md');
    const blocks = JSON.parse(/^export const blocks = (.*);$/m.exec(code)![1]!) as {
      kind: string;
    }[];
    expect(blocks.map((block) => block.kind)).toEqual(['html', 'island', 'html']);
  });

  test('and fails the build anywhere else', async () => {
    await expect(transform(post, '/repo/src/content/guide/page.md')).rejects.toThrow(/islands/);
  });
});
