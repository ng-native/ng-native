import type { EngineNode } from '@ng-native/fabric';
import { required } from './dom-error.ts';
import {
  contentOf,
  insertMarkup,
  markupOf,
  outerMarkupOf,
  setMarkup,
  setOuterMarkup,
} from './html.ts';
import { innerText, setInnerText, setOuterText } from './inner-text.ts';
import { together } from './mutation-observer.ts';
import { engineOf } from './window.ts';

/**
 * The members of an element for its markup and its text as rendered: `innerHTML`, `outerHTML`
 * and `insertAdjacentHTML`, see `html.ts`; `innerText` and `outerText`, see `inner-text.ts`; and
 * a `<template>`'s `content`.
 */

type Dom = EngineNode;

const get = (read: (this: Dom) => unknown, write?: (this: Dom, value: unknown) => void) => ({
  get: read,
  set: write,
});

export const markupMembers: PropertyDescriptorMap = {
  // Written, one change: what it held out and what the markup is in.
  innerHTML: get(
    function () {
      return markupOf(this);
    },
    function (markup) {
      together(this, () => setMarkup(this, markup, engineOf(this)));
    },
  ),
  outerHTML: get(
    function () {
      return this.nodeKind === 'element' ? outerMarkupOf(this) : undefined;
    },
    function (markup) {
      setOuterMarkup(this, markup, engineOf(this));
    },
  ),
  insertAdjacentHTML: {
    value(this: Dom, ...args: unknown[]) {
      required(args, 2, 'insertAdjacentHTML');
      insertMarkup(this, args[0], args[1], engineOf(this));
    },
    writable: true,
  },
  // The text as it is rendered: see `inner-text.ts`.
  innerText: get(
    function () {
      return innerText(this);
    },
    function (value) {
      setInnerText(this, value);
    },
  ),
  outerText: get(
    function () {
      return innerText(this);
    },
    function (value) {
      setOuterText(this, value);
    },
  ),
  // A `<template>`'s content: a fragment of its own, which what its markup is goes into.
  content: get(function () {
    return this.tag === 'template' ? contentOf(this, engineOf(this)) : undefined;
  }),
};
