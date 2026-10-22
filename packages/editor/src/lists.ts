import { type Attributes, wrappingInputRule } from "@tiptap/core";
import { OrderedList } from "@tiptap/extension-list";

const STYLES: Record<string, string> = {
  a: "lower-alpha",
  A: "upper-alpha",
  i: "lower-roman",
  I: "upper-roman",
};

// Lettered and roman lists. The marker style is written inline because CSS can't tell
// type="a" from type="A" in HTML; TipTap reads it back from the same style when parsing.
// "a. " and "i. " start them, like "1. " starts a numbered list.
export const OrderedListStyles = OrderedList.extend({
  addAttributes() {
    const parent: Attributes = this.parent?.() ?? {};
    return {
      ...parent,
      type: {
        ...parent.type,
        renderHTML: (attrs: { type?: string | null }) => {
          const style = attrs.type ? STYLES[attrs.type] : undefined;
          return style ? { type: attrs.type, style: `list-style-type: ${style}` } : {};
        },
      },
    };
  },

  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      // Only join a list of the same style, so "a. " under a numbered list starts a new list.
      wrappingInputRule({ find: /^a\.\s$/, type: this.type, getAttributes: { type: "a" }, joinPredicate: (_m, node) => node.attrs.type === "a" }),
      wrappingInputRule({ find: /^i\.\s$/, type: this.type, getAttributes: { type: "i" }, joinPredicate: (_m, node) => node.attrs.type === "i" }),
    ];
  },
});
