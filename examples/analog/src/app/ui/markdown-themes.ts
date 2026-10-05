import { Component, ViewEncapsulation } from '@angular/core';
import type { MarkdownClasses } from '@ng-native/components/markdown';

/** A look for a document: the classes `<markdown>` is given, and the card it sits on. */
export interface MarkdownTheme {
  readonly name: string;
  readonly card: string;
  readonly classes: MarkdownClasses;
}

/**
 * The default look, then two the app makes its own. A link keeps `md-a` beside its own class, so
 * it stays pressable-looking; every other element takes only the app's class.
 */
export const MARKDOWN_THEMES: readonly MarkdownTheme[] = [
  { name: 'Default', card: 'theme-card', classes: {} },
  {
    name: 'Editorial',
    card: 'theme-card editorial-card',
    classes: {
      h1: 'editorial-h1',
      h2: 'editorial-h2',
      p: 'editorial-p',
      a: 'md-a editorial-a',
      blockquote: 'editorial-quote',
      hr: 'editorial-hr',
    },
  },
  {
    name: 'Terminal',
    card: 'theme-card terminal-card',
    classes: {
      h1: 'terminal-h1',
      h2: 'terminal-h2',
      p: 'terminal-p',
      marker: 'terminal-marker',
      a: 'md-a terminal-a',
      blockquote: 'terminal-quote',
      code: 'terminal-code',
      hr: 'terminal-hr',
    },
  },
];

/**
 * The themes' classes. Unencapsulated, so its sheet is a global one once it renders, which is what
 * reaches the elements `<markdown>` creates.
 */
@Component({
  selector: 'app-markdown-themes',
  template: '',
  encapsulation: ViewEncapsulation.None,
  styles: `
    .theme-card {
      padding: 20px 18px;
    }

    .editorial-card {
      background-color: light-dark(#fbf6ee, #241d16);
    }

    .editorial-h1 {
      font-family: Georgia;
      font-size: 34px;
      line-height: 40px;
      font-weight: 700;
      color: light-dark(#7a1424, #ff8a9c);
      margin-bottom: 6px;
    }

    .editorial-h2 {
      font-family: Georgia;
      font-size: 22px;
      line-height: 28px;
      font-style: italic;
      color: light-dark(#7a1424, #ff8a9c);
      margin-top: 10px;
    }

    .editorial-p {
      font-family: Georgia;
      font-size: 18px;
      line-height: 28px;
      color: light-dark(#2b2118, #efe6dc);
    }

    .editorial-a {
      font-weight: 700;
    }

    .editorial-quote {
      padding: 4px 0 4px 16px;
      border-left-width: 3px;
      border-left-color: #dd0330;
    }

    .editorial-hr {
      height: 1px;
      margin: 8px 40px;
      background-color: light-dark(#d8c9b4, #4a3b2c);
    }

    .terminal-card {
      background-color: #0d1117;
    }

    .terminal-h1,
    .terminal-h2,
    .terminal-p,
    .terminal-marker,
    .terminal-code {
      font-family: Menlo;
    }

    .terminal-h1 {
      font-size: 24px;
      line-height: 32px;
      font-weight: 700;
      color: #ff4d6d;
    }

    .terminal-h2 {
      font-size: 17px;
      line-height: 26px;
      font-weight: 700;
      color: #7ee787;
      margin-top: 8px;
    }

    .terminal-p {
      font-size: 14px;
      line-height: 22px;
      color: #c9d1d9;
    }

    .terminal-marker {
      font-size: 14px;
      color: #7ee787;
    }

    .terminal-a {
      color: #79c0ff;
    }

    .terminal-quote {
      padding: 10px 12px;
      border-radius: 6px;
      background-color: #161b22;
    }

    .terminal-code {
      color: #ffa657;
      background-color: #161b22;
    }

    .terminal-hr {
      height: 1px;
      margin: 8px 0;
      background-color: #30363d;
    }
  `,
})
export class MarkdownThemes {}
