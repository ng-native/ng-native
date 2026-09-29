import { describe, expect, test } from 'vitest';
import { highlight, markdown } from './markdown.ts';

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
