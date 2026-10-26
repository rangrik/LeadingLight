import Highlight from "@tiptap/extension-highlight";

export const highlightColors = ["yellow", "orange", "green", "blue", "purple", "pink", "gray"] as const;

export const TextHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const color = element.getAttribute("data-color");
          return highlightColors.some((name) => name === color) ? color : null;
        },
        renderHTML: ({ color }) => highlightColors.some((name) => name === color) ? { "data-color": color } : {},
      },
    };
  },
}).configure({ multicolor: true });
