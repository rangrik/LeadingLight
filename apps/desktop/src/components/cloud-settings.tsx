import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudSync } from 'lucide-react';
import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Badge } from '@leadinglight/ui/components/badge';
import { Button } from '@leadinglight/ui/components/button';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarGroup, useSidebar } from '@leadinglight/ui/components/sidebar';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@leadinglight/ui/components/tooltip';
import { useCloud, refreshCloud, startCloud } from '~/lib/cloud';
import { platform } from '~/lib/platform';
import { syncEnabled, syncKey } from '~/lib/sync';
import { NativeApprovalDialog } from './native-approval';

// Where sync stands, in a word short enough to sit beside the row's name. Someone who never signed in is told nothing.
function standing(cloud: ReturnType<typeof useCloud>): { text: string; warn?: boolean } {
  if (!cloud.initialized) return { text: '' };
  if (!cloud.user) return !cloud.known || cloud.known.left ? { text: '' } : cloud.ended ? { text: 'Sign in', warn: true } : { text: 'Offline' };
  const bound = localStorage.getItem('leadinglight.sync-owner');
  if (bound && bound !== cloud.user.id) return { text: 'Check', warn: true };
  if (!navigator.onLine) return { text: 'Offline' };
  if (!syncKey()) return { text: 'Sync off' };
  if (!syncEnabled()) return { text: 'Paused' };
  if (cloud.sync === 'Syncing…' || cloud.sync === 'Connecting…') return { text: 'Syncing' };
  // 'Off' here is the moment before the first sync of this run.
  return cloud.sync === 'Up to date' ? { text: 'Synced' } : cloud.sync === 'Off' ? { text: '' } : { text: 'Check', warn: true };
}

const openAccount = () => window.dispatchEvent(new Event('leadinglight:cloud-account'));

// The iPhone's Notes list keeps a full row.
export function CloudButton() {
  const { text, warn } = standing(useCloud());
  return <SidebarGroup className="py-1"><SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={openAccount}>
    <Cloud className="size-4" /><span className="min-w-0 flex-1 truncate">Account and sync</span>
    {text && (warn ? <Badge variant="warning">{text}</Badge> : <span className="shrink-0 text-muted-foreground text-xs">{text}</span>)}
  </SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>;
}

const SYNC_ICON: Record<string, typeof Cloud> = { Synced: CloudCheck, Syncing: CloudSync, Offline: CloudOff, 'Sync off': CloudOff, Paused: CloudOff };

// The sidebar toolbar's button: the icon shows where sync stands, the tooltip says it.
export function CloudIconButton() {
  const { text, warn } = standing(useCloud());
  const Icon = warn ? CloudAlert : SYNC_ICON[text] ?? Cloud;
  const name = text ? `Account and sync · ${text}` : 'Account and sync';
  return <Tooltip>
    <TooltipTrigger render={<Button aria-label={name} onClick={openAccount} size="icon-sm" variant="ghost" />}>
      <Icon className={warn ? 'text-warning-foreground' : undefined} />
    </TooltipTrigger>
    <TooltipPopup>{name}</TooltipPopup>
  </Tooltip>;
}

// Starts the account checks and sends "Account and sync" to its place in Settings. In a browser it also holds the page a new device opens.
export function CloudSettings() {
  const native = platform.use() !== 'browser';
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    startCloud();
    // The Agents part is far down a page that may still be loading, so look for it a few times.
    const agents = (tries: number) => { const part = document.getElementById('account-agents'); if (part) part.scrollIntoView(); else if (tries) setTimeout(() => agents(tries - 1), 100); };
    const account = (event: Event) => {
      if (isMobile) setOpenMobile(false);
      useStore.getState().setView({ kind: 'settings', section: 'account' });
      void refreshCloud();
      if (event instanceof CustomEvent && event.detail === 'agents') agents(20);
    };
    window.addEventListener('leadinglight:cloud-account', account);
    return () => window.removeEventListener('leadinglight:cloud-account', account);
  }, [isMobile, setOpenMobile]);
  return native ? null : <NativeApprovalDialog />;
}
