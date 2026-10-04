import { Component } from '@angular/core';
import { HlmBreadcrumbImports } from './helm/breadcrumb';
import { HlmPaginationImports } from './helm/pagination';

/** Spartan UI's breadcrumb and pagination: lists of links, which go through the router. */
@Component({
  selector: 'app-spartan-navigation',
  imports: [HlmBreadcrumbImports, HlmPaginationImports],
  host: { class: 'spartan flex flex-col gap-4' },
  template: `
    <nav hlmBreadcrumb testID="breadcrumb">
      <ol hlmBreadcrumbList testID="breadcrumb-list">
        <li hlmBreadcrumbItem><a hlmBreadcrumbLink link="/" testID="crumb-home">Home</a></li>
        <li hlmBreadcrumbSeparator testID="crumb-separator"></li>
        <li hlmBreadcrumbItem><hlm-breadcrumb-ellipsis /></li>
        <li hlmBreadcrumbSeparator></li>
        <li hlmBreadcrumbItem><a hlmBreadcrumbLink link="/spartan">Components</a></li>
        <li hlmBreadcrumbSeparator></li>
        <li hlmBreadcrumbItem><span hlmBreadcrumbPage testID="crumb-page">Breadcrumb</span></li>
      </ol>
    </nav>

    <nav hlmPagination testID="pagination">
      <ul hlmPaginationContent testID="pagination-list">
        <li hlmPaginationItem><hlm-pagination-previous link="/spartan" /></li>
        <li hlmPaginationItem><a hlmPaginationLink link="/spartan" testID="page-1">1</a></li>
        <li hlmPaginationItem>
          <a hlmPaginationLink link="/spartan" isActive testID="page-2">2</a>
        </li>
        <li hlmPaginationItem><hlm-pagination-ellipsis /></li>
        <li hlmPaginationItem><hlm-pagination-next link="/spartan" /></li>
      </ul>
    </nav>
  `,
})
export class SpartanNavigation {}
