import { CheckIcon, CodeXmlIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { openEditor } from "@/components/editors/open";
import { MenuItem } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { type Editor, installedEditors, setPreferredEditor, usePreferredEditor } from "@/lib/editors";
import { useStore } from "@/lib/store";

// EditorMenuItems lists the editors installed on this computer for an
// "Open in" submenu; picking one also makes it the preferred editor.
export function EditorMenuItems({ box, path }: { box: string; path: string }) {
  const client = useStore((s) => s.client);
  const preferred = usePreferredEditor();
  const [editors, setEditors] = useState<Editor[]>();
  useEffect(() => {
    if (client) void installedEditors(client).then(setEditors);
  }, [client]);
  if (!editors)
    return (
      <MenuItem disabled>
        <Spinner className="size-3.5" /> Looking for editors…
      </MenuItem>
    );
  const installed = editors.filter((e) => e.installed);
  if (!installed.length) return <MenuItem disabled>No supported editor installed</MenuItem>;
  return (
    <>
      {installed.map((e) => (
        <MenuItem
          key={e.id}
          onClick={() => {
            setPreferredEditor(e.id);
            void openEditor({ box, path, editor: e.id });
          }}
        >
          <CodeXmlIcon />
          {e.name}
          {e.id === preferred && <CheckIcon className="ms-auto size-3.5 opacity-60" />}
        </MenuItem>
      ))}
    </>
  );
}
