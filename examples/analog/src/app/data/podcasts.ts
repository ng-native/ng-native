/** A podcast in the library. */
export interface Show {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly artwork: string;
}

/** One episode of a show. */
export interface Episode {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly show: Show;
  readonly minutes: number;
}

/** The shows under one letter, as `<section-list>` takes them. */
export interface ShowSection {
  readonly title: string;
  readonly data: readonly Show[];
}

const art = (photo: number) => `https://picsum.photos/id/${photo}/200/200`;

export const SHOWS: readonly Show[] = [
  { id: 'after-hours', name: 'After Hours', host: 'Mina Okafor', artwork: art(1011) },
  { id: 'atlas', name: 'Atlas', host: 'Jonas Berg', artwork: art(1015) },
  { id: 'build-log', name: 'Build Log', host: 'Priya Natarajan', artwork: art(1018) },
  { id: 'bright-signals', name: 'Bright Signals', host: 'Theo Marsh', artwork: art(1019) },
  { id: 'change-detection', name: 'Change Detection', host: 'Ana Ruiz', artwork: art(1021) },
  { id: 'deep-field', name: 'Deep Field', host: 'Sam Kowalski', artwork: art(1022) },
  { id: 'dispatch', name: 'Dispatch', host: 'Lena Fischer', artwork: art(1024) },
  { id: 'fieldwork', name: 'Fieldwork', host: 'Omar Haddad', artwork: art(1025) },
  { id: 'frame-rate', name: 'Frame Rate', host: 'Ruth Adeyemi', artwork: art(1027) },
  { id: 'good-defaults', name: 'Good Defaults', host: 'Kenji Mori', artwork: art(1028) },
  { id: 'hot-reload', name: 'Hot Reload', host: 'Clara Novak', artwork: art(1029) },
  { id: 'lazy-loaded', name: 'Lazy Loaded', host: 'Diego Alves', artwork: art(1031) },
  { id: 'long-form', name: 'Long Form', host: 'Iris Lindqvist', artwork: art(1033) },
  { id: 'main-thread', name: 'Main Thread', host: 'Felix Brandt', artwork: art(1035) },
  { id: 'night-shift', name: 'Night Shift', host: 'Hana Sato', artwork: art(1036) },
  { id: 'open-source-hour', name: 'Open Source Hour', host: 'Marco Bianchi', artwork: art(1037) },
  { id: 'pixel-perfect', name: 'Pixel Perfect', host: 'Nora Quinn', artwork: art(1039) },
  { id: 'quiet-mode', name: 'Quiet Mode', host: 'Elif Demir', artwork: art(1040) },
  { id: 'release-notes', name: 'Release Notes', host: 'Tom Gallagher', artwork: art(1041) },
  { id: 'signal-hour', name: 'Signal Hour', host: 'Ada Kim', artwork: art(1043) },
  { id: 'slow-news', name: 'Slow News', host: 'Pavel Ivanov', artwork: art(1044) },
  { id: 'the-stack', name: 'The Stack', host: 'Yara Haddad', artwork: art(1047) },
  { id: 'tide-tables', name: 'Tide Tables', host: 'Eli Turner', artwork: art(1048) },
  { id: 'west-coast', name: 'West Coast', host: 'June Park', artwork: art(1050) },
];

const TOPICS = [
  'The case for boring technology',
  'Shipping on a Friday',
  'What a frame costs',
  'Signals, one year in',
  'Designing for one thumb',
  'The long tail of a release',
  'Notes from the night train',
  'Why lists are hard',
  'A week without meetings',
  'Native, all the way down',
  'Small teams, big apps',
  'The art of the default',
];

/** How many episodes the library holds: enough that only a window of them is ever drawn. */
export const EPISODE_COUNT = 360;

/** Every episode, newest first, made up the same way each time. */
export const EPISODES: readonly Episode[] = Array.from({ length: EPISODE_COUNT }, (_, index) => {
  const number = EPISODE_COUNT - index;
  const show = SHOWS[(number * 7) % SHOWS.length]!;
  return {
    id: `episode-${number}`,
    number,
    title: TOPICS[number % TOPICS.length]!,
    show,
    minutes: 18 + ((number * 13) % 57),
  };
});

const matches = (query: string, ...fields: string[]) => {
  const wanted = query.trim().toLowerCase();
  return wanted === '' || fields.some((field) => field.toLowerCase().includes(wanted));
};

/** The episodes whose title or show has `query` in it; all of them for an empty one. */
export function searchEpisodes(query: string): readonly Episode[] {
  return EPISODES.filter((episode) => matches(query, episode.title, episode.show.name));
}

/** The shows whose name or host has `query` in it, under their first letter. */
export function showSections(query: string): readonly ShowSection[] {
  const sections = new Map<string, Show[]>();
  for (const show of SHOWS) {
    if (!matches(query, show.name, show.host)) continue;
    const letter = show.name.replace(/^The /, '')[0]!.toUpperCase();
    sections.set(letter, [...(sections.get(letter) ?? []), show]);
  }
  return [...sections]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, data]) => ({ title, data }));
}
