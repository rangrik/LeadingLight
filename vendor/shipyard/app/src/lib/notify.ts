import { type Category, route } from "@/lib/notifications";

type Kind = "info" | "success" | "warning" | "error";

export interface NotifyAction {
  label: string;
  run(): void;
}

// notify sends a message through the notification centre's router, so the
// person's settings decide whether it toasts, reaches macOS, or stays quiet.
// Plugins' ctx.notify lands here.
export function notify(title: string, body?: string, kind: Kind = "info", action?: NotifyAction, category: Category = "plugin") {
  route({ category, title, detail: body, tone: kind, run: action?.run, label: action?.label });
}
