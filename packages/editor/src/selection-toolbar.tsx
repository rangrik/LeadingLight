import { type Editor, isTextSelection } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Highlighter, Italic, Link, MessageSquarePlus, Sparkles, Strikethrough, TextQuote, Underline, Unlink } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Input } from "@leadinglight/ui/components/input";
import { Toolbar, ToolbarSeparator } from "@leadinglight/ui/components/toolbar";
import { TooltipProvider } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { flipWithin, surface, ToolButton } from "./ui";

function LinkEditor({
  href,
  onApply,
  onRemove,
  onClose,
  onLeave,
}: {
  href: string;
  onApply: (href: string) => boolean;
  onRemove: () => void;
  onClose: () => void;
  onLeave: () => void;
}) {
  const [value, setValue] = useState(href);
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    // TipTap refuses unsafe or malformed links; say so instead of doing nothing.
    if (!v || /\s/.test(v) || !onApply(/^[a-z]+:/i.test(v) ? v : `https://${v}`)) setInvalid(true);
  };
  return (
    <form className="flex min-w-0 flex-1 items-center gap-0.5" onSubmit={submit}>
      <Input
        aria-invalid={invalid || undefined}
        aria-label="Link URL"
        autoFocus
        className="min-w-0 flex-1"
        // Focus going anywhere outside the toolbar (a click on the page) closes the field.
        onBlur={(e) => !e.currentTarget.closest("[role=toolbar]")?.contains(e.relatedTarget as Node | null) && onLeave()}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Paste a link"
        size="sm"
        value={value}
      />
      {href && (
        <ToolButton label="Remove link" onClick={onRemove}>
          <Unlink />
        </ToolButton>
      )}
    </form>
  );
}

// `note` offers "Add sidenote"; `quote` offers "Add to essay" once the page has one. onAsk, when
// given, adds Ask at the end: the app opens its agent panel on the selection.
export function SelectionToolbar({
  editor,
  note,
  quote,
  onAsk,
  annotate,
  askKeys,
}: {
  editor: Editor;
  note?: boolean;
  quote?: { label: string; run: () => void };
  onAsk?: () => void;
  // Words that can't change: only a sidenote, and Ask, are offered.
  annotate?: boolean;
  askKeys?: string;
}) {
  const [linkWidth, setLinkWidth] = useState<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      highlight: editor.isActive("highlight"),
      link: editor.isActive("link"),
      href: (editor.getAttributes("link").href as string | undefined) ?? "",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }),
  });

  // A new selection always starts on the buttons, not the link field.
  useEffect(() => setLinkWidth(null), [s.from, s.to]);

  const chain = () => editor.chain().focus();
  // The link field takes the button row's width, so the toolbar stays centred.
  const openLink = () => setLinkWidth(toolbarRef.current?.offsetWidth ?? null);
  const closeLink = () => setLinkWidth(null);
  // Escape leaves the field for the text it was editing, not for nowhere.
  const cancelLink = () => {
    closeLink();
    editor.commands.focus();
  };

  return (
    <BubbleMenu
      // Above the block handle, which sits later in the page.
      className="z-20"
      editor={editor}
      options={{ placement: "top", offset: 8, flip: flipWithin(editor.view.dom) }}
      pluginKey="selectionToolbar"
      shouldShow={({ editor, element, state, from, to }) => {
        const focused = editor.isFocused || element.contains(document.activeElement);
        if (!focused || !editor.isEditable || editor.isActive("codeBlock")) return false;
        if (!isTextSelection(state.selection) || from === to) return false;
        return state.doc.textBetween(from, to, " ").trim().length > 0;
      }}
      updateDelay={0}
    >
      <TooltipProvider delay={500}>
        <Toolbar
          aria-label="Text formatting"
          className={cn(surface, "items-center gap-0.5 p-1")}
          ref={toolbarRef}
          style={linkWidth ? { width: linkWidth } : undefined}
        >
          {linkWidth ? (
            <LinkEditor
              href={s.href}
              onApply={(href) => {
                const ok = chain().extendMarkRange("link").setLink({ href }).run();
                if (ok) closeLink();
                return ok;
              }}
              onClose={cancelLink}
              onLeave={() => {
                closeLink();
                editor.view.dispatch(editor.state.tr.setMeta("selectionToolbar", "hide"));
              }}
              onRemove={() => {
                chain().extendMarkRange("link").unsetLink().run();
                closeLink();
              }}
            />
          ) : (
            <>
              {!annotate && (
                <>
                  <ToolButton label="Bold" onClick={() => chain().toggleBold().run()} pressed={s.bold} shortcut="⌘B">
                    <Bold />
                  </ToolButton>
                  <ToolButton label="Italic" onClick={() => chain().toggleItalic().run()} pressed={s.italic} shortcut="⌘I">
                    <Italic />
                  </ToolButton>
                  <ToolButton label="Underline" onClick={() => chain().toggleUnderline().run()} pressed={s.underline} shortcut="⌘U">
                    <Underline />
                  </ToolButton>
                  <ToolButton label="Strikethrough" onClick={() => chain().toggleStrike().run()} pressed={s.strike} shortcut="⌘⇧S">
                    <Strikethrough />
                  </ToolButton>
                  <ToolButton label="Code" onClick={() => chain().toggleCode().run()} pressed={s.code} shortcut="⌘E">
                    <Code />
                  </ToolButton>
                  <ToolButton label="Highlight" onClick={() => chain().toggleHighlight().run()} pressed={s.highlight} shortcut="⌘⇧H">
                    <Highlighter />
                  </ToolButton>
                  <ToolbarSeparator className="mx-0.5 h-4" orientation="vertical" />
                  <ToolButton label="Link" onClick={openLink} pressed={s.link}>
                    <Link />
                  </ToolButton>
                </>
              )}
              {(note || quote) && !annotate && <ToolbarSeparator className="mx-0.5 h-4" orientation="vertical" />}
              {note && (
                <ToolButton label="Add sidenote" onClick={() => editor.commands.addSidenote()} shortcut="⌘⇧M">
                  <MessageSquarePlus />
                </ToolButton>
              )}
              {quote && !annotate && (
                <ToolButton label={quote.label} onClick={quote.run}>
                  <TextQuote />
                </ToolButton>
              )}
              {onAsk && (
                <>
                  <ToolbarSeparator className="mx-0.5 h-4" orientation="vertical" />
                  <ToolButton
                    label="Ask about this"
                    onClick={() => {
                      onAsk();
                      // The panel takes over; the toolbar would otherwise stay over the text.
                      editor.view.dispatch(editor.state.tr.setMeta("selectionToolbar", "hide"));
                    }}
                    shortcut={askKeys}
                  >
                    <Sparkles />
                  </ToolButton>
                </>
              )}
            </>
          )}
        </Toolbar>
      </TooltipProvider>
    </BubbleMenu>
  );
}
