import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Scene } from "@/components/art/scenes";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import type { PluginInfo } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { builtinOn, setBuiltinOn, usePrefs } from "@/lib/prefs";
import { useStore } from "@/lib/store";
import { askToAllow } from "@/plugins/consent";
import { builtinPlugins, loadPlugins } from "@/plugins/host";
import { PluginBoundary, pluginContexts } from "@/plugins/plugin-boundary";
import { screenOwner, usePluginsLoading, useRegistry } from "@/plugins/registry";
import { PluginPage, ViewHeader, ViewHeaderHost } from "@/views/view-header";

// PluginScreenView lays a plugin's screen out like the app's own views: the
// strip on top (the plugin's ViewHeader, or its title until it renders one)
// and, unless it asks to fill the area, one page width below it, so no
// plugin picks its own.
export function PluginScreenView({ screen }: { screen: string }) {
  const entry = useRegistry((s) => s.screens.find((c) => c.item.id === screen));
  const owner = useRegistry((s) => s.plugins.find((p) => p.id === screenOwner(screen))?.name);
  if (!entry) {
    return (
      <div className="flex h-full flex-col">
        <ViewHeader title={owner ?? "Plugin"} />
        <div className="min-h-0 flex-1">
          <MissingScreen screen={screen} />
        </div>
      </div>
    );
  }
  const { plugin, item } = entry;
  const body = <item.Component berth={pluginContexts.get(plugin)!} />;
  return (
    <div className="flex h-full flex-col">
      <ViewHeaderHost key={item.id} fallback={{ title: item.title, description: item.description }}>
        <PluginBoundary plugin={plugin}>
          {item.layout === "fill" ? (
            <div className="flex min-h-0 flex-1 flex-col">{body}</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PluginPage>{body}</PluginPage>
            </div>
          )}
        </PluginBoundary>
      </ViewHeaderHost>
    </div>
  );
}

// MissingScreen stands in for a plugin's screen while its plugin is not
// loaded: still loading, turned off, failed, or no longer installed. It names
// the plugin when it can and offers the one step that brings the screen back.
function MissingScreen({ screen }: { screen: string }) {
  const loading = usePluginsLoading();
  const ownerId = screenOwner(screen);
  const status = useRegistry((s) => s.plugins.find((p) => p.id === ownerId));
  const enabledPlugins = usePrefs((p) => p.enabledPlugins);
  const disabledPlugins = usePrefs((p) => p.disabledPlugins);
  const [info, setInfo] = useState<PluginInfo | null>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !ownerId) return;
    let live = true;
    const client = useStore.getState().client;
    void Promise.all([client ? client.plugins().catch(() => [] as PluginInfo[]) : [], builtinPlugins()]).then(([user, builtins]) => {
      // A plugin of yours replaces a built-in with the same id.
      if (live) setInfo(user.find((p) => p.id === ownerId) ?? builtins.find((p) => p.id === ownerId) ?? null);
    });
    return () => {
      live = false;
    };
  }, [loading, ownerId]);

  const reload = async () => {
    const client = useStore.getState().client;
    if (!client) return;
    setBusy(true);
    try {
      await loadPlugins(client);
    } finally {
      setBusy(false);
    }
  };

  const turnOn = async (p: PluginInfo) => {
    const client = useStore.getState().client;
    if (!client) return;
    setBusy(true);
    try {
      if (p.builtin) setBuiltinOn(p, true);
      // A plugin of yours runs only once you've allowed it.
      else if (!(await askToAllow(p))) return;
      await loadPlugins(client);
    } catch (err) {
      toastManager.add({ title: `Couldn't turn on ${p.name}`, description: errorMessage(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => useStore.getState().setView({ kind: "settings", section: "plugins" });

  if (loading || (ownerId && info === undefined)) {
    return (
      <Empty className="h-full">
        <Spinner className="size-5 text-muted-foreground" />
        <EmptyDescription>Loading plugins…</EmptyDescription>
      </Empty>
    );
  }

  const name = info?.name ?? status?.name;
  const off = info ? (info.builtin ? !builtinOn(info, { enabledPlugins, disabledPlugins }) : info.enabled !== true) : false;
  const failed = !off && status?.state === "failed";

  let title: string;
  let description: string;
  if (info && off) {
    title = `${name} is off`;
    description = `This screen comes from the ${name} plugin, which is turned off in Settings → Plugins.`;
  } else if (failed) {
    title = `${name} didn't load`;
    description = status?.error ? `${status.error}` : `The ${name} plugin stopped while it was starting.`;
  } else if (name) {
    title = `${name} isn't installed`;
    description = `This screen comes from the ${name} plugin, which this computer no longer has. Install it again, or pick another place in the sidebar.`;
  } else {
    title = "This plugin isn't loaded";
    description = "The plugin that adds this screen is off or no longer installed. Turn it on in Settings → Plugins.";
  }

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia>
          {/* Off is at anchor; failed is weather; gone is an empty berth. */}
          <Scene name={info && off ? "anchor" : failed ? "storm" : "ended"} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          {info && off ? (
            <Button size="sm" loading={busy} onClick={() => void turnOn(info)}>
              Turn it on
            </Button>
          ) : (
            <Button size="sm" variant={failed ? "default" : "outline"} loading={busy} onClick={() => void reload()}>
              <RefreshCwIcon />
              Try again
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={openSettings}>
            Settings → Plugins
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}
