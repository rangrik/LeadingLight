import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { seal, unseal, type Envelope } from '../src/lib/remote-crypto';

type Command = { seq: string; id: string; controller: string; turn: string; kind: string; envelope: Envelope };

// Seam: the actual relay persists encrypted protocol, acknowledges Stop, and deduplicates tool events.
test('real relay connects browser approval and Stop to an encrypted test Mac', async ({ page, context }) => {
  test.skip(!process.env.CLOUD_QA, 'Requires the isolated browser-server and PostgreSQL.');
  test.setTimeout(90_000);
  await context.addCookies([{ name: 'qa-user', value: `pair-e2e-${crypto.randomUUID()}`, url: 'http://127.0.0.1:1431' }]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a Mac', exact: true }).click();
  const code = await page.getByLabel('Pairing code', { exact: true }).inputValue();
  const [, pairId, encoded] = code.split(':'), token = randomBytes(32).toString('base64url');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const key = await crypto.subtle.importKey('raw', Buffer.from(encoded, 'base64url'), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const native = async (path: string, body: object) => {
    const response = await fetch(`http://127.0.0.1:8787/api/relay/device/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ pairId, ...body }) });
    if (!response.ok) throw new Error(`Native fixture ${path}: ${response.status} ${JSON.stringify(await response.json())}`);
    return response.json();
  };
  let after = '0';
  const waiting: Command[] = [];
  const command = async (kind: string) => {
    await expect.poll(async () => {
      const result = await native('poll', { after });
      waiting.push(...result.commands);
      if (result.commands.length) after = result.commands.at(-1).seq;
      return waiting.some((entry) => entry.kind === kind);
    }, { timeout: 15_000 }).toBe(true);
    const packet = waiting.splice(waiting.findIndex((entry) => entry.kind === kind), 1)[0];
    const value = await unseal<Record<string, any>>(key, { pair: pairId, direction: 'browser', ...packet }, packet.envelope);
    return { packet, value };
  };
  const events = async (packet: Command, values: object[], state?: string, duplicate = false) => {
    const entries = await Promise.all(values.map(async (value) => {
      const id = crypto.randomUUID();
      return { id, controller: packet.controller, turn: packet.turn, kind: 'event', envelope: await seal(key, { pair: pairId, controller: packet.controller, turn: packet.turn, direction: 'mac', id, kind: 'event' }, value) };
    }));
    const body = { events: entries, ...(state ? { runs: [{ id: packet.turn, state }] } : {}) };
    await native('events', body);
    if (duplicate) await native('events', body);
  };
  const receipt = (packet: Command) => ({ type: 'receipt', messageId: packet.id, ok: true });
  const line = (value: object) => ({ type: 'line', line: value });
  try {
    await native('claim', { inviteHash: hash(`LeadingLight pairing v1:${pairId}:${encoded}`), credentialHash: hash(token), macName: 'Relay test Mac' });
    await page.getByRole('button', { name: 'Refresh connections' }).click();
    await expect(page.getByText('Waiting for approval on your Mac', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use this Mac', exact: true })).toHaveCount(0);
    await native('approve', {});
    const statusId = crypto.randomUUID();
    await native('poll', { after, status: { id: statusId, envelope: await seal(key, { pair: pairId, controller: '', turn: '', direction: 'mac', id: statusId, kind: 'status' }, { claude: { installed: true, logged_in: true }, codex: { account: { result: { account: null } } } }) } });
    await page.getByRole('button', { name: 'Refresh connections' }).click();
    await page.getByRole('button', { name: 'Use this Mac', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connected', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Relay round trip');
    await page.getByRole('textbox', { name: 'Page body' }).fill('Private original words.');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.getByRole('textbox', { name: 'Question' }).fill('Add an approved sentence.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const start = await command('start');
    expect(start.value.ask.prompt).toContain('Private original words.');
    await events(start.packet, [receipt(start.packet), line({ type: 'control_request', request_id: 'approve', request: { subtype: 'can_use_tool', tool_name: 'mcp__notes__insert_text', tool_use_id: 'approved-edit', input: { markdown: 'Added through the real relay.' } } })], 'running');
    await page.getByRole('button', { name: 'Allow once', exact: true }).click();
    const approval = await command('reply');
    expect(approval.value.message.response.response.behavior).toBe('allow');
    await events(approval.packet, [receipt(approval.packet), line({ type: 'control_request', request_id: 'tool', request: { subtype: 'mcp_message', message: { jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'insert_text', arguments: { markdown: 'Added through the real relay.' } } } } })], undefined, true);
    const result = await command('reply');
    await events(result.packet, [receipt(result.packet), line({ type: 'result', result: 'Done', session_id: 'relay-session', is_error: false })], 'done');
    const body = page.getByRole('textbox', { name: 'Page body' });
    await expect(body).toContainText('Added through the real relay.');
    expect((await body.innerText()).match(/Added through the real relay/g)).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Question' }).fill('Start a task I will stop.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const next = await command('start');
    expect(next.value.ask.resume).toBe('relay-session');
    await events(next.packet, [receipt(next.packet)], 'running');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
    const stopped = await command('cancel');
    // A confirmed stopped event is enough even when its separate command receipt is lost.
    await events(stopped.packet, [{ type: 'ended', how: 'stopped' }], 'stopped');
    await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Stopped');
  } finally { await native('revoke', {}).catch(() => {}); }
});
