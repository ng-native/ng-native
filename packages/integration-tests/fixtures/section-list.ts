import { Component, signal, viewChild } from '@angular/core';
import {
  SectionFooter,
  SectionHeader,
  SectionItem,
  SectionList,
  SectionListSeparator,
  SectionSeparator,
} from '../../components/src/section-list.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

export { flattenSections } from '../../components/src/section-list.ts';

interface Section {
  title: string;
  data: string[];
}

/** Twenty sections of five items: a 30pt header, 40pt items and a 10pt footer each. */
@Component({
  selector: 'x-sections-list',
  imports: [
    SectionList,
    SectionHeader,
    SectionItem,
    SectionFooter,
    SectionSeparator,
    SectionListSeparator,
    Text,
    View,
  ],
  template: `
    <section-list
      #list
      [sections]="sections()"
      [itemHeight]="40"
      [sectionHeaderHeight]="30"
      [sectionFooterHeight]="10"
      [overscan]="1"
      [stickySectionHeadersEnabled]="sticky()"
      [style]="fill"
      (endReached)="ended = ended + 1"
    >
      <ng-template sectionHeader let-section let-at="sectionIndex">
        <view nativeID="header"
          ><text>{{ section.title }}#{{ at }}</text></view
        >
      </ng-template>
      <ng-template sectionItem let-item let-index="index" let-section="section">
        <view nativeID="item"
          ><text>{{ section.title }}.{{ index }}={{ item }}</text></view
        >
      </ng-template>
      <ng-template sectionFooter let-section>
        <view nativeID="footer"
          ><text>end {{ section.title }}</text></view
        >
      </ng-template>
      <ng-template sectionSeparator let-leading let-trailing="trailingItem">
        <view nativeID="separator"
          ><text>{{ leading }}|{{ trailing }}</text></view
        >
      </ng-template>
      <ng-template
        sectionListSeparator
        let-section
        let-before="leadingSection"
        let-after="trailingSection"
        let-leading="leadingItem"
        let-trailing="trailingItem"
      >
        <view nativeID="edge"
          ><text
            >{{ before?.title ?? '' }}[{{ section.title }}]{{ after?.title ?? '' }}:{{
              leading ?? ''
            }}|{{ trailing ?? '' }}</text
          ></view
        >
      </ng-template>
    </section-list>
  `,
})
export class SectionsList {
  readonly sections = signal<Section[]>(
    Array.from({ length: 20 }, (_, s) => ({
      title: 'S' + s,
      data: Array.from({ length: 5 }, (_, i) => 'i' + s + '-' + i),
    })),
  );
  readonly sticky = signal<boolean | undefined>(undefined);
  readonly list = viewChild.required(SectionList);
  readonly fill = { flex: 1 };
  ended = 0;
}
