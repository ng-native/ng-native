import * as i0 from "@angular/core";
import { Component, Input, NO_ERRORS_SCHEMA, booleanAttribute } from "@angular/core";
var AliasedStyles = class AliasedStyles {
	constructor() {
		this.styles = "unset";
	}
	static {
		this.ɵfac = i0.ɵɵngDeclareFactory({
			minVersion: "12.0.0",
			version: "22.2.0",
			ngImport: i0,
			type: AliasedStyles,
			deps: [],
			target: i0.ɵɵFactoryTarget.Component
		});
	}
	static {
		this.ɵcmp = i0.ɵɵngDeclareComponent({
			minVersion: "14.0.0",
			version: "22.2.0",
			type: AliasedStyles,
			isStandalone: true,
			selector: "acme-aliased-styles",
			inputs: { styles: ["customStyles", "styles"] },
			ngImport: i0,
			template: "<text>{{ styles }}</text>",
			isInline: true,
			styles: [":host{padding:1px}\n"]
		});
	}
};
i0.ɵɵngDeclareClassMetadata({
	minVersion: "12.0.0",
	version: "22.2.0",
	ngImport: i0,
	type: AliasedStyles,
	decorators: [{
		type: Component,
		args: [{
			schemas: [NO_ERRORS_SCHEMA],
			selector: "acme-aliased-styles",
			template: "<text>{{ styles }}</text>",
			styles: [":host{padding:1px}\n"]
		}]
	}],
	propDecorators: { styles: [{
		type: Input,
		args: ["customStyles"]
	}] }
});
var TransformedStyles = class TransformedStyles {
	constructor() {
		this.styles = false;
	}
	static {
		this.ɵfac = i0.ɵɵngDeclareFactory({
			minVersion: "12.0.0",
			version: "22.2.0",
			ngImport: i0,
			type: TransformedStyles,
			deps: [],
			target: i0.ɵɵFactoryTarget.Component
		});
	}
	static {
		this.ɵcmp = i0.ɵɵngDeclareComponent({
			minVersion: "16.1.0",
			version: "22.2.0",
			type: TransformedStyles,
			isStandalone: true,
			selector: "acme-transformed-styles",
			inputs: { styles: [
				"styles",
				"styles",
				booleanAttribute
			] },
			ngImport: i0,
			template: "<text>{{ styles }}</text>",
			isInline: true,
			styles: [":host{padding:2px}\n"]
		});
	}
};
i0.ɵɵngDeclareClassMetadata({
	minVersion: "12.0.0",
	version: "22.2.0",
	ngImport: i0,
	type: TransformedStyles,
	decorators: [{
		type: Component,
		args: [{
			schemas: [NO_ERRORS_SCHEMA],
			selector: "acme-transformed-styles",
			template: "<text>{{ styles }}</text>",
			styles: [":host{padding:2px}\n"]
		}]
	}],
	propDecorators: { styles: [{
		type: Input,
		args: [{ transform: booleanAttribute }]
	}] }
});
var StylesInText = class StylesInText {
	static {
		this.ɵfac = i0.ɵɵngDeclareFactory({
			minVersion: "12.0.0",
			version: "22.2.0",
			ngImport: i0,
			type: StylesInText,
			deps: [],
			target: i0.ɵɵFactoryTarget.Component
		});
	}
	static {
		this.ɵcmp = i0.ɵɵngDeclareComponent({
			minVersion: "14.0.0",
			version: "22.2.0",
			type: StylesInText,
			isStandalone: true,
			selector: "acme-styles-in-text",
			ngImport: i0,
			template: "<text>styles: [ \"kept\" ] and type: Nope, here</text>",
			isInline: true,
			styles: [":host{padding:3px}\n"]
		});
	}
};
i0.ɵɵngDeclareClassMetadata({
	minVersion: "12.0.0",
	version: "22.2.0",
	ngImport: i0,
	type: StylesInText,
	decorators: [{
		type: Component,
		args: [{
			schemas: [NO_ERRORS_SCHEMA],
			selector: "acme-styles-in-text",
			template: "<text>styles: [ \"kept\" ] and type: Nope, here</text>",
			styles: [":host{padding:3px}\n"]
		}]
	}]
});
export { AliasedStyles, StylesInText, TransformedStyles };

