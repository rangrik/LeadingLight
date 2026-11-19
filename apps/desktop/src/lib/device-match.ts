type Keys = { privateKey: CryptoKey; publicKey: CryptoKey };
export type Match = {
  id: string;
  requester: string;
  target: string;
  project: string | null;
  notes: boolean;
  requesterKey: JsonWebKey;
  targetKey: JsonWebKey;
};
export type Wrapped = { iv: string; data: string };
const utf8 = new TextEncoder();
const encode = (v: Uint8Array) => btoa(Array.from(v, (n) => String.fromCharCode(n)).join(''));
const decode = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
let opening: Promise<IDBDatabase> | undefined;
export async function deviceKey(owner: string): Promise<Keys> {
  opening ??= new Promise((resolve, reject) => {
    const op = indexedDB.open('leadinglight-device-keys', 1);
    op.onupgradeneeded = () => op.result.createObjectStore('keys');
    op.onsuccess = () => resolve(op.result);
    op.onerror = () => {
      opening = undefined;
      reject(op.error);
    };
  });
  const db = await opening;
  const read = db.transaction('keys').objectStore('keys').get(owner);
  const existing = await new Promise<Keys | undefined>((resolve, reject) => {
    read.onsuccess = () => resolve(read.result);
    read.onerror = () => reject(read.error);
  });
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite'),
      store = tx.objectStore('keys'),
      get = store.get(owner);
    let result = pair;
    get.onsuccess = () => {
      if (get.result) result = get.result;
      else store.add(pair, owner);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
  });
}
export async function matchKeys(owner: string, me: string, link: Match) {
  if (me !== link.requester && me !== link.target) throw new Error('This connection belongs to another device.');
  const own = await deviceKey(owner);
  const same = me === link.requester ? link.requesterKey : link.targetKey;
  const local = await crypto.subtle.exportKey('jwk', own.publicKey);
  if (same.x !== local.x || same.y !== local.y) throw new Error('The device key changed. Start again.');
  const remote = me === link.requester ? link.targetKey : link.requesterKey;
  const peer = await crypto.subtle.importKey('jwk', remote, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, own.privateKey, 256);
  const secret = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const context = utf8.encode(
    JSON.stringify([
      'll-device-link-v1',
      owner,
      link.id,
      link.requester,
      link.target,
      link.project,
      link.notes,
      link.requesterKey.x,
      link.requesterKey.y,
      link.targetKey.x,
      link.targetKey.y,
    ]),
  );
  const params = { name: 'HKDF', hash: 'SHA-256', salt: context };
  const nums = new Uint8Array(await crypto.subtle.deriveBits({ ...params, info: utf8.encode('number match') }, secret, 128));
  const number = 10 + ((nums[0] * 256 + nums[1]) % 90);
  const key = await crypto.subtle.deriveKey(
    { ...params, info: utf8.encode('approved access') },
    secret,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return {
    number,
    async seal(payload: unknown): Promise<Wrapped> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: context },
        key,
        utf8.encode(JSON.stringify(payload)),
      );
      return { iv: encode(iv), data: encode(new Uint8Array(data)) };
    },
    async open<T>(e: Wrapped): Promise<T> {
      const raw = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decode(e.iv), additionalData: context },
        key,
        decode(e.data),
      );
      return JSON.parse(new TextDecoder().decode(raw));
    },
  };
}
export function choices(number: number) {
  const set = new Set([number]);
  while (set.size < 3) set.add(10 + (crypto.getRandomValues(new Uint16Array(1))[0] % 90));
  return Array.from(set).sort((a, b) => a - b);
}
