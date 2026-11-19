import { useState, useEffect } from 'react';
import { SettingsGroup, SettingsRow } from '@/views/settings/rows';
import { Button } from '@leadinglight/ui/components/button';
import { Switch } from '@leadinglight/ui/components/switch';
import { platform, useMobile } from '~/lib/platform';
import { mobileAgents, refreshMobileAgents, disconnectMobileAgents } from '~/lib/mobile-agents';
import { mobileNotifications, setMobileNotifications } from '~/lib/mobile-notifications';
import { MobileAgentsButton } from '~/components/mobile-agents';

import { ask } from '~/lib/project-runtime/transport';

function EarlierMacAccess() {
  const [enabled, setEnabled] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void ask<{ enabled: boolean }>('GET', '/v1/mobile')
      .then((r) => setEnabled(r.enabled))
      .catch(() => {});
  }, []);
  if (!enabled) return null;
  return (
    <SettingsGroup title="Earlier connections">
      <SettingsRow
        label="Devices paired with a code"
        description="Turn off access for all devices that used the old connection code."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await ask('PUT', '/v1/mobile', { enabled: false });
              setEnabled(false);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Stop sharing
        </Button>
      </SettingsRow>
      {error && <p role="alert">{error}</p>}
    </SettingsGroup>
  );
}

export function MobileAgentAccess() {
  const os = platform.use(),
    state = mobileAgents.use(),
    mobile = useMobile(),
    notifications = mobileNotifications.use();
  const [error, setError] = useState('');
  useEffect(() => {
    void refreshMobileAgents();
  }, []);
  if (!state.connection) return os === 'macos' ? <EarlierMacAccess /> : null;
  return (
    <>
      {os === 'macos' && <EarlierMacAccess />}
      <SettingsGroup title="Remote Mac">
        <SettingsRow label={state.connection.name} description={state.online ? 'Online' : 'Offline'}>
          <MobileAgentsButton />
        </SettingsRow>
        {mobile && (
          <SettingsRow label="Agent notifications">
            <Switch
              checked={notifications.enabled}
              disabled={notifications.busy}
              onCheckedChange={(v) => void setMobileNotifications(v).catch((e) => setError(String(e)))}
            />
          </SettingsRow>
        )}
        <SettingsRow label="Stop using this Mac on this device">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void disconnectMobileAgents().catch((e) => setError(String(e)))}
          >
            Disconnect
          </Button>
        </SettingsRow>
        {error && <p role="alert">{error}</p>}
      </SettingsGroup>
    </>
  );
}
