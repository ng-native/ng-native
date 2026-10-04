import type { MarkdownFile } from '@ng-native/metro/markdown-file';
import formatting from '../../notes/formatting.md';
import styled from '../../notes/styled.md';
import welcome from '../../notes/welcome.md';

/** A note's front matter. A type rather than an interface, so a file's attributes cast to it. */
export type NoteAttributes = {
  readonly title: string;
  readonly summary: string;
};

/** A `.md` file in `src/notes`, as Metro made it a module, and the slug it is opened by. */
export interface Note {
  readonly slug: string;
  readonly file: MarkdownFile<NoteAttributes>;
}

const note = (slug: string, file: MarkdownFile): Note => ({
  slug,
  file: file as MarkdownFile<NoteAttributes>,
});

/** The notes the library lists, in its order. */
export const NOTES: readonly Note[] = [note('welcome', welcome), note('formatting', formatting)];

/** The note `/styled` draws with the app's own classes. */
export const STYLED_NOTE = note('styled', styled);

export function noteBySlug(slug: string | null | undefined): Note | undefined {
  return NOTES.find((candidate) => candidate.slug === slug);
}
