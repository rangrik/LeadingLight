import { Globe } from "lucide-react";
import { useWorkspace } from "~/components/agent-browser";
import { ProjectChat } from "~/components/project-chat";

export function BrowserChat() {
  const { workspace, error } = useWorkspace("");
  if (!workspace) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"><Globe className="size-6" /><p role={error ? "alert" : "status"}>{error || "Opening your browser chat…"}</p></div>;
  return <ProjectChat browserWorkspace={workspace} pageId="" />;
}
