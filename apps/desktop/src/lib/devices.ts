import { cloudApi } from './cloud';
import { createStore } from './state';

// The installed apps signed in to this account, as the service lists them.
export type Device = { id: string; name: string; kind: 'mac' | 'ipad' | 'iphone'; createdAt: string; lastSeen: string | null; current: boolean };
export const devices = createStore<Device[] | null>(null);
export async function refreshDevices() { devices.set((await cloudApi<{ devices: Device[] }>('devices')).devices); }
export const removeDevice = (id: string) => cloudApi('devices/remove', { id }).then(refreshDevices);
export const nameDevice = (name: string) => cloudApi('devices/name', { name }).then(refreshDevices);
