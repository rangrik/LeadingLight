import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TextSelection } from "@tiptap/pm/state";
import { NodeViewContent, type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer, useEditorState } from "@tiptap/react";
import { Check, ChevronsUpDown, Copy, Download } from "lucide-react";
import { common, createLowlight } from "lowlight";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Select, SelectItem, SelectPopup, SelectPrimitive, SelectValue } from "@leadinglight/ui/components/select";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "@leadinglight/ui/components/tooltip";

const lowlight = createLowlight(common);

const LANGUAGES: [string, string, string][] = [
  ["plaintext", "Plain text", "txt"],
  ["bash", "Bash", "sh"],
  ["c", "C", "c"],
  ["cpp", "C++", "cpp"],
  ["csharp", "C#", "cs"],
  ["css", "CSS", "css"],
  ["diff", "Diff", "diff"],
  ["go", "Go", "go"],
  ["graphql", "GraphQL", "graphql"],
  ["xml", "HTML / XML", "html"],
  ["java", "Java", "java"],
  ["javascript", "JavaScript", "js"],
  ["json", "JSON", "json"],
  ["kotlin", "Kotlin", "kt"],
  ["markdown", "Markdown", "md"],
  ["objectivec", "Objective-C", "m"],
  ["php", "PHP", "php"],
  ["python", "Python", "py"],
  ["ruby", "Ruby", "rb"],
  ["rust", "Rust", "rs"],
  ["scss", "SCSS", "scss"],
  ["shell", "Shell", "sh"],
  ["sql", "SQL", "sql"],
  ["swift", "Swift", "swift"],
  ["typescript", "TypeScript", "ts"],
  ["yaml", "YAML", "yaml"],
];
const LABELS = Object.fromEntries(LANGUAGES.map(([id, name]) => [id, name]));

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="text-muted-foreground"
            onClick={onClick}
            onMouseDown={(e) => e.preventDefault()}
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function CodeBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "plaintext";
  const ext = LANGUAGES.find(([id]) => id === language)?.[2] ?? "txt";
  const [copied, setCopied] = useState(false);
  // Controls show while the cursor is inside the block, as well as on hover.
  const inside = useEditorState({
    editor,
    selector: ({ editor }) => {
      const pos = getPos();
      const { from } = editor.state.selection;
      return pos !== undefined && from > pos && from < pos + node.nodeSize;
    },
  });

  const copy = async () => {
    await navigator.clipboard.writeText(node.textContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([node.textContent], { type: "text/plain" }));
    a.download = `snippet.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <NodeViewWrapper className="ll-code group/code relative" data-inside={inside || undefined}>
      <TooltipProvider delay={500}>
        <div
          // top-4 centres the 24px buttons on the code's first line.
          className="absolute top-4 right-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 group-data-inside/code:opacity-100 has-data-popup-open:opacity-100"
          contentEditable={false}
        >
          <Select
            disabled={!editor.isEditable}
            items={LABELS}
            onValueChange={(value) => updateAttributes({ language: value })}
            value={language}
          >
            <SelectPrimitive.Trigger
              aria-label="Language"
              render={<Button className="gap-1 font-sans text-muted-foreground" size="xs" variant="ghost" />}
            >
              <SelectValue />
              <ChevronsUpDown className="size-4" />
            </SelectPrimitive.Trigger>
            <SelectPopup alignItemWithTrigger={false}>
              {LANGUAGES.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <IconAction label={copied ? "Copied" : "Copy code"} onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </IconAction>
          <IconAction label="Download code" onClick={download}>
            <Download className="size-4" />
          </IconAction>
        </div>
      </TooltipProvider>
      <pre spellCheck={false}>
        <NodeViewContent<"code"> as="code" className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Three Enters leave the block, reusing the empty paragraph after it when there is one.
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type !== this.type) return false;
        const atEnd = $from.parentOffset === $from.parent.content.size;
        if (!atEnd || !$from.parent.textContent.endsWith("\n\n")) return false;
        const tr = state.tr.delete($from.pos - 2, $from.pos);
        const after = tr.mapping.map($from.after());
        const next = tr.doc.nodeAt(after);
        if (!(next && next.type.name === "paragraph" && next.content.size === 0)) {
          tr.insert(after, state.schema.nodes.paragraph.create());
        }
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
}).configure({ lowlight, defaultLanguage: "plaintext", enableTabIndentation: true, tabSize: 2 });
