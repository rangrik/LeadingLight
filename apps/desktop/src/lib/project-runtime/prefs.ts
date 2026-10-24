import { localPrefs } from "~/lib/local-prefs";

// Linked folders and project chats are in development (docs/PROJECT-1.md): off until a person
// turns them on in Settings › AI › Projects.
export const projectPrefs = localPrefs("ll.projects", { enabled: false });
