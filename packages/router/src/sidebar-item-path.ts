/**
 * `<sidebar-item path="inbox">`: a sidebar item the route selects, as a `<native-tab>`'s path
 * selects its tab, and that navigates there when chosen.
 *
 * `<sidebar-item>` is in `@ng-native/components`, which this package cannot import, so the item
 * provides `SIDEBAR_SELECTION` from `@ng-native/device`: this writes it as the url changes, and
 * the item's `[(selected)]` reads it back.
 */
import { DestroyRef, Directive, Service, effect, inject, input, signal } from '@angular/core';
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
  type UrlTree,
} from '@angular/router';
import { SIDEBAR_SELECTION } from '@ng-native/device';
import { primarySegments } from './url-commands.ts';

const segmentsOf = (path: string): string[] => path.split('/').filter(Boolean);

/**
 * Which of the sidebar items that share a parent route the url selects: the one with the longest
 * path that starts it, as a tab bar picks its tab. An item at `''` has the parent's own url, which
 * starts every url under it, so it takes the parent's url exactly, or one no other item takes.
 *
 * @param base the parent route's segments
 * @param url the url's segments
 * @param paths each item's path
 * @returns the index of the item selected, or -1 for none
 */
export function selectedPath(
  base: readonly string[],
  url: readonly string[],
  paths: readonly string[],
): number {
  if (base.some((segment, index) => url[index] !== segment) || url.length < base.length) return -1;
  const rest = url.slice(base.length);
  let found = -1;
  let depth = 0;
  let index = -1;
  for (const path of paths) {
    index++;
    const own = segmentsOf(path);
    if (own.length === 0 || own.length > rest.length || own.length <= depth) continue;
    if (own.every((segment, at) => rest[at] === segment)) {
      found = index;
      depth = own.length;
    }
  }
  if (found === -1) found = paths.findIndex((path) => segmentsOf(path).length === 0);
  return found;
}

/** The sidebar items with a path, grouped by the route their paths are relative to. */
@Service()
class SidebarPaths {
  private readonly groups = new Map<ActivatedRoute, Set<SidebarItemPath>>();
  /** Bumped as items come and go, so every item of a group looks again. */
  readonly changed = signal(0);

  add(route: ActivatedRoute, item: SidebarItemPath): () => void {
    const group = this.groups.get(route) ?? new Set();
    this.groups.set(route, group);
    group.add(item);
    this.changed.update((count) => count + 1);
    return () => {
      group.delete(item);
      if (group.size === 0) this.groups.delete(route);
      this.changed.update((count) => count + 1);
    };
  }

  of(route: ActivatedRoute): readonly SidebarItemPath[] {
    return [...(this.groups.get(route) ?? [])];
  }
}

@Directive({
  selector: 'sidebar-item[path]',
  host: { '(select)': 'navigate()' },
})
export class SidebarItemPath {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly selection = inject(SIDEBAR_SELECTION);
  private readonly paths = inject(SidebarPaths);

  /** The route this item selects, relative to the page it is on, as a `<native-tab>`'s is. */
  readonly path = input.required<string>();

  /** The url, read again after every navigation, kept or not: a refused one leaves it as it was. */
  private readonly url = signal(this.router.url, { equal: () => false });

  constructor() {
    const remove = this.paths.add(this.route, this);
    const events = this.router.events.subscribe((event) => {
      const settled =
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError;
      if (settled) this.url.set(this.router.url);
    });
    inject(DestroyRef).onDestroy(() => {
      remove();
      events.unsubscribe();
    });
    effect(() => {
      this.paths.changed();
      const url = primarySegments(this.router, this.url()).map((segment) => segment.path);
      const base = this.route.snapshot.pathFromRoot.flatMap((route) =>
        route.url.map((segment) => segment.path),
      );
      const group = this.paths.of(this.route);
      const index = selectedPath(
        base,
        url,
        group.map((item) => item.path()),
      );
      this.selection.set(group[index] === this);
    });
  }

  /** The user chose the item: go to its route. */
  protected navigate(): void {
    void this.router.navigateByUrl(this.target());
  }

  private target(): UrlTree {
    return this.router.createUrlTree(segmentsOf(this.path()), { relativeTo: this.route });
  }
}
