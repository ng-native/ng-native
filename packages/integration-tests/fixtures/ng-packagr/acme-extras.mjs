import * as i0 from "@angular/core";
import { Component, NO_ERRORS_SCHEMA } from "@angular/core";
var Docs = class Docs {
	constructor() {
		this.sample = "i0.ɵɵngDeclareComponent({ type: Fake, styles: ['.a { color: red }'] })";
	}
	static {
		this.ɵfac = i0.ɵɵngDeclareFactory({
			minVersion: "12.0.0",
			version: "22.2.0",
			ngImport: i0,
			type: Docs,
			deps: [],
			target: i0.ɵɵFactoryTarget.Component
		});
	}
	static {
		this.ɵcmp = i0.ɵɵngDeclareComponent({
			minVersion: "14.0.0",
			version: "22.2.0",
			type: Docs,
			isStandalone: true,
			selector: "acme-docs",
			ngImport: i0,
			template: "<text>docs</text>",
			isInline: true,
			styles: [":host{padding:1px}\n"]
		});
	}
};
i0.ɵɵngDeclareClassMetadata({
	minVersion: "12.0.0",
	version: "22.2.0",
	ngImport: i0,
	type: Docs,
	decorators: [{
		type: Component,
		args: [{
			schemas: [NO_ERRORS_SCHEMA],
			selector: "acme-docs",
			template: "<text>docs</text>",
			styles: [":host{padding:1px}\n"]
		}]
	}]
});
var Card = class Card {
	static {
		this.ɵfac = i0.ɵɵngDeclareFactory({
			minVersion: "12.0.0",
			version: "22.2.0",
			ngImport: i0,
			type: Card,
			deps: [],
			target: i0.ɵɵFactoryTarget.Component
		});
	}
	static {
		this.ɵcmp = i0.ɵɵngDeclareComponent({
			minVersion: "14.0.0",
			version: "22.2.0",
			type: Card,
			isStandalone: true,
			selector: "acme-card",
			ngImport: i0,
			template: "<text class=\"label\">card</text>",
			isInline: true,
			styles: [":host{display:flex;padding:4px}.label:before{content:\"x\"}:host ::ng-deep .inner{color:#010203}\n"]
		});
	}
};
i0.ɵɵngDeclareClassMetadata({
	minVersion: "12.0.0",
	version: "22.2.0",
	ngImport: i0,
	type: Card,
	decorators: [{
		type: Component,
		args: [{
			schemas: [NO_ERRORS_SCHEMA],
			selector: "acme-card",
			template: "<text class=\"label\">card</text>",
			styles: [":host{display:flex;padding:4px}.label:before{content:\"x\"}:host ::ng-deep .inner{color:#010203}\n"]
		}]
	}]
});
var Toggle = class Toggle {
	static {
		this.ɵfac = i0.ɵɵngDeclareFactory({
			minVersion: "12.0.0",
			version: "22.2.0",
			ngImport: i0,
			type: Toggle,
			deps: [],
			target: i0.ɵɵFactoryTarget.Component
		});
	}
	static {
		this.ɵcmp = i0.ɵɵngDeclareComponent({
			minVersion: "14.0.0",
			version: "22.2.0",
			type: Toggle,
			isStandalone: true,
			selector: "acme-toggle",
			ngImport: i0,
			template: "<text class=\"ripple\">toggle</text>",
			isInline: true,
			styles: [".ripple:after:not(:empty){transform:translateZ(0)}:host{padding:2px}.ripple{color:#040506}\n"]
		});
	}
};
i0.ɵɵngDeclareClassMetadata({
	minVersion: "12.0.0",
	version: "22.2.0",
	ngImport: i0,
	type: Toggle,
	decorators: [{
		type: Component,
		args: [{
			schemas: [NO_ERRORS_SCHEMA],
			selector: "acme-toggle",
			template: "<text class=\"ripple\">toggle</text>",
			styles: [".ripple:after:not(:empty){transform:translateZ(0)}:host{padding:2px}.ripple{color:#040506}\n"]
		}]
	}]
});
export { Card, Docs, Toggle };

