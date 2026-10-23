/**
 * A url string as the commands `Router.navigate()` takes.
 *
 * `navigate` reads a string command as segment text: it escapes the url's escapes a second time,
 * keeps a `;` as part of the segment and writes a named outlet's brackets into the path.
 * `navigateByUrl` and `popTo` parse the string instead, and these commands say what they read.
 */
import {
  PRIMARY_OUTLET,
  UrlSegment,
  type Router,
  type UrlSegmentGroup,
  type UrlTree,
} from '@angular/router';

/**
 * Matrix parameter names `navigate` reads as a command rather than as parameters, with no way to
 * escape them. A segment's parameters go in without them, and `withWrittenParameters` puts them
 * back on the tree the commands make.
 */
const COMMAND_KEYS = ['outlets', 'segmentPath'];

/** One segment as commands: its decoded path, then its matrix parameters if it has any. */
export function segmentCommands(segment: UrlSegment): unknown[] {
  const parameters = Object.fromEntries(
    Object.entries(segment.parameters).filter(([name]) => !COMMAND_KEYS.includes(name)),
  );
  return Object.keys(parameters).length > 0 ? [segment.path, parameters] : [segment.path];
}

/** Whether a path has a matrix parameter `segmentCommands` leaves out. */
export function hasCommandKeyParameters(router: Router, path: string): boolean {
  return primarySegments(router, path).some((segment) =>
    COMMAND_KEYS.some((name) => name in segment.parameters),
  );
}

/**
 * `tree`, the one `path`'s commands made, with the parameters of the segments written in `path`
 * as written. They are the last segments of `outlet`, under whatever a relative path went up from.
 */
export function withWrittenParameters(
  router: Router,
  tree: UrlTree,
  path: string,
  outlet: string = PRIMARY_OUTLET,
): UrlTree {
  const written = primarySegments(router, path).slice(dotsWritten(path));
  const places: { group: UrlSegmentGroup; index: number }[] = [];
  let group: UrlSegmentGroup | undefined = tree.root.children[outlet];
  while (group) {
    group.segments.forEach((_, index) => places.push({ group: group!, index }));
    group = group.children[PRIMARY_OUTLET];
  }
  const start = places.length - written.length;
  written.forEach((segment, i) => {
    const place = places[start + i];
    if (!place) return;
    const current = place.group.segments[place.index]!;
    place.group.segments[place.index] = new UrlSegment(current.path, segment.parameters);
  });
  return tree;
}

/**
 * How many `.` and `..` a relative path starts with, counted in the string as written: a decoded
 * `%2E%2E` is a segment.
 */
function dotsWritten(path: string): number {
  if (path === '' || path.startsWith('/')) return 0;
  const parts = path.split('/');
  const written = parts.findIndex((part) => part !== '.' && part !== '..');
  return written < 0 ? parts.length : written;
}

/** The segments of a path's primary outlet, down through every level, decoded. */
export function primarySegments(router: Router, path: string): UrlSegment[] {
  const segments: UrlSegment[] = [];
  let group: UrlSegmentGroup | undefined = router.parseUrl(path).root;
  while (group) {
    segments.push(...group.segments);
    group = group.children[PRIMARY_OUTLET];
  }
  return segments;
}

/**
 * The commands for a url string's path, its query and fragment already cut off. An empty path is
 * the root, as `navigateByUrl('?q=1')` reads it.
 */
export function urlCommands(router: Router, path: string): unknown[] {
  if (path === '' || path.startsWith('/')) {
    return ['/', ...groupCommands(router.parseUrl(path).root)];
  }
  const list = groupCommands(router.parseUrl(path).root);
  // `navigate` splits its first command on `/` and reads `.` and `..` there, and only there. So the
  // dots written as dots go into it together, `['../..', 'x']`, where `['..', '..', 'x']` would look
  // for a segment named `..`.
  const up = dotsWritten(path);
  if (up > 0) return [list.slice(0, up).join('/'), ...list.slice(up)];
  // A first segment the url escaped, `a%2Fb` or `%2E%2E`, stays one segment, as `segmentPath`.
  const [first] = list;
  if (typeof first === 'string' && (first.includes('/') || first === '.' || first === '..')) {
    list[0] = { segmentPath: first };
  }
  return list;
}

function groupCommands(group: UrlSegmentGroup): unknown[] {
  const list = group.segments.flatMap(segmentCommands);
  const outlets = Object.entries(group.children);
  if (outlets.length === 0) return list;
  if (outlets.length === 1 && outlets[0]![0] === PRIMARY_OUTLET) {
    return [...list, ...groupCommands(outlets[0]![1])];
  }
  return [
    ...list,
    { outlets: Object.fromEntries(outlets.map(([name, child]) => [name, groupCommands(child)])) },
  ];
}
