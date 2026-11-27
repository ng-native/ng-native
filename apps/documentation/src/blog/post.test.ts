import { describe, expect, test } from 'vitest';
import { toPost } from './post.ts';

const front = {
  title: 'T',
  summary: 'S',
  date: '2026-11-24',
  minutes: 4,
  tag: 'Announcement',
  author: 'ashley-hunter',
};

describe('toPost', () => {
  test('takes the slug from the file name', () => {
    expect(toPost('./posts/my-post.md', front).slug).toBe('my-post');
  });

  test('rejects a date YAML read as a Date', () => {
    expect(() => toPost('a.md', { ...front, date: new Date('2026-11-24') })).toThrow(/date/);
  });

  test('rejects an author with no entry', () => {
    expect(() => toPost('a.md', { ...front, author: 'nobody' })).toThrow(/author/);
  });
});
