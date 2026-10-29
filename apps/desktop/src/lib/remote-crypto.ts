export type Envelope = { v: 1; iv: string; data: string };
export type MessageRoute = { pair: string; controller: string; turn: string; direction: 'browser' | 'mac'; id: string; kind: string };
const utf8 = new TextEncoder();
const bytes64 = (bytes: Uint8Array) => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
const from64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const aad = (r: MessageRoute) => utf8.encode(JSON.stringify([1, r.pair, r.controller, r.turn, r.direction, r.id, r.kind]));

export async function pairingKey() {
  const id = crypto.randomUUID(), secret = crypto.getRandomValues(new Uint8Array(32));
  const encoded = bytes64(secret).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const digest = await crypto.subtle.digest('SHA-256', utf8.encode(`LeadingLight pairing v1:${id}:${encoded}`));
  const inviteHash = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt']);
  secret.fill(0);
  return { id, key, inviteHash, code: `llpair1:${id}:${encoded}` };
}

export async function seal(key: CryptoKey, route: MessageRoute, value: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(route) }, key, utf8.encode(JSON.stringify(value)));
  return { v: 1, iv: bytes64(iv), data: bytes64(new Uint8Array(data)) };
}

export async function unseal<T>(key: CryptoKey, route: MessageRoute, envelope: Envelope): Promise<T> {
  if (envelope?.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string' || envelope.data.length > 1_500_000) throw new Error('Invalid encrypted message.');
  const iv = from64(envelope.iv);
  if (iv.length !== 12) throw new Error('Invalid encrypted message.');
  const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(route) }, key, from64(envelope.data));
  return JSON.parse(new TextDecoder().decode(text)) as T;
}
