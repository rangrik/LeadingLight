import { expect, test, type Page } from '@playwright/test';
import { seal, unseal, type Envelope } from '../src/lib/remote-crypto';
import type { PairRecord } from '../src/lib/remote';
import type { AskRequest } from '../src/lib/agent';

test.use({ serviceWorkers: 'block' });

// Seam: browser tools and approvals must use the paired transport without replaying mutations.
async function pairedMac(page: Page, codex = false, ready = true) {
  let offline = false;
  let user = 'paired-browser-test';
  let cursor = 0;
  let rejection: number | null = null;
  let delayedPoll: { started: () => void; released: Promise<void> } | undefined;
  let delayedAccount: { started: () => void; released: Promise<void> } | undefined;
  let pair: PairRecord | undefined, key: CryptoKey, mode: 'approval' | 'hold' = 'approval', cancel: (() => Promise<void>) | undefined;
  const starts: AskRequest[] = [], wire: unknown[] = [], replies: Record<string, any>[] = [];
  const events: { seq: string; id: string; controller: string; turn: string; kind: 'event'; envelope: Envelope }[] = [];
  const emit = async (turn: string, value: unknown) => {
    const id = crypto.randomUUID(), controller = pair!.controller!;
    events.push({ seq: String(events.length + 1), id, controller, turn, kind: 'event', envelope: await seal(key, { pair: pair!.id, controller, turn, direction: 'mac', id, kind: 'event' }, value) });
  };
  const line = (turn: string, value: object) => emit(turn, { type: 'line', line: value });
  const publishStatus = async () => {
    const statusId = crypto.randomUUID();
    pair!.status = { id: statusId, envelope: await seal(key, { pair: pair!.id, controller: '', turn: '', direction: 'mac', id: statusId, kind: 'status' }, { claude: { installed: ready, logged_in: ready }, codex: { account: { result: { account: codex && ready ? { type: 'chatgpt', email: 'you@example.com', planType: 'pro' } : null } }, models: { result: { data: codex && ready ? [{ id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium', hidden: false }] : [] } } } }) };
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postDataJSON();
    if (body) wire.push(body);
    if (pair?.state === 'active' && !offline) pair.lastSeen = new Date().toISOString();
    let result: unknown = {}, status = 200;
    if (path === '/api/config') result = { ready: true, allowed: true, providers: [], agents: [] };
    else if (path === '/api/me') {
      if (delayedAccount) { const delayed = delayedAccount; delayedAccount = undefined; delayed.started(); await delayed.released; }
      result = { id: user, name: 'Test workspace' };
    }
    else if (path === '/api/relay/pairs' && method === 'POST') {
      pair = { serverTime: new Date().toISOString(), id: body.id, browserName: body.browserName, accountName: 'Test workspace', macName: null, state: 'pending', expiresAt: new Date(Date.now() + 300_000).toISOString(), lastSeen: null, browserSeen: null, controller: null };
      result = { pair };
    } else if (path === '/api/relay/pairs') result = { pairs: pair && user === 'paired-browser-test' ? [pair] : [] };
    else if (path.endsWith('/control')) {
      if (pair!.controller && !body.takeover) { status = 409; result = { error: 'Another tab controls this Mac.' }; }
      else { pair!.controller = body.controller; pair!.browserSeen = new Date().toISOString(); result = { pair, after: String(events.length) }; }
    } else if (path.endsWith('/events')) {
      cursor = Number(url.searchParams.get('after'));
      const delayed = delayedPoll; delayedPoll = undefined;
      if (delayed) await line(starts.at(-1)!.id, { type: 'control_request', request_id: 'late-tool', request: { subtype: 'mcp_message', message: { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'insert_text', arguments: { markdown: 'Stale account mutation.' } } } } });
      result = { pair, events: events.filter((event) => event.controller === url.searchParams.get('controller') && Number(event.seq) > Number(url.searchParams.get('after'))).flatMap((event) => [event, event]) };
      if (delayed) { delayed.started(); await delayed.released; }
    }
    else if (path.endsWith('/messages') && body.kind === 'start' && rejection) { status = rejection; result = { error: `Start refused with ${rejection}.` }; }
    else if (path.endsWith('/messages')) {
      const packet = await unseal<{ type: string; ask?: AskRequest; message?: Record<string, any> }>(key, { pair: pair!.id, controller: body.controller, turn: body.turn, direction: 'browser', id: body.id, kind: body.kind }, body.envelope);
      const receipt = () => emit(body.turn, { type: 'receipt', messageId: body.id, ok: true });
      if (packet.type === 'cancel') cancel = receipt;
      else {
        await receipt();
        if (packet.type === 'ask') {
          starts.push(packet.ask!);
          if (packet.ask!.provider === 'codex') await line(body.turn, { id: 0, result: {} });
          else {
            await line(body.turn, { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } });
            await line(body.turn, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Reply from your Mac.' } } });
            if (mode === 'approval') await line(body.turn, { type: 'control_request', request_id: 'permission', request: { subtype: 'can_use_tool', tool_name: 'mcp__notes__insert_text', tool_use_id: 'edit-once', input: { markdown: 'One approved addition.' } } });
          }
        } else if (packet.message?.method === 'thread/start' || packet.message?.method === 'thread/resume') {
          replies.push(packet.message);
          await line(body.turn, { id: 1, result: { thread: { id: 'codex-mac-thread' } } });
        } else if (packet.message?.method === 'turn/start') {
          replies.push(packet.message);
          await line(body.turn, { id: 2, result: { turn: { id: 'codex-turn' } } });
          await line(body.turn, { method: 'item/started', params: { item: { id: 'codex-answer', type: 'agentMessage', text: '', phase: 'commentary' } } });
          await line(body.turn, { method: 'item/agentMessage/delta', params: { itemId: 'codex-answer', delta: 'Codex from your Mac.' } });
          if (mode === 'approval') await line(body.turn, { id: 9, method: 'item/tool/call', params: { tool: 'insert_text', callId: 'codex-edit', arguments: { markdown: 'One approved Codex addition.' } } });
        } else if (packet.message?.id === 9) {
          replies.push(packet.message);
          await line(body.turn, { method: 'turn/completed', params: { turn: { id: 'codex-turn', status: 'completed' } } });
        } else if (packet.message?.response?.request_id === 'permission') {
          await line(body.turn, { type: 'control_request', request_id: 'page-tool', request: { subtype: 'mcp_message', message: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'insert_text', arguments: { markdown: 'One approved addition.' } } } } });
        } else if (packet.message?.response?.request_id === 'page-tool') await line(body.turn, { type: 'result', result: 'Done.', session_id: 'mac-session', is_error: false });
      }
      result = { id: body.id };
    } else if (method === 'DELETE') { pair!.state = 'revoked'; result = { ok: true }; }
    if (pair) pair.serverTime = new Date().toISOString();
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return {
    starts, wire, replies, codex,
    async codexEvents(lines: object[]) { for (const value of lines) await line(starts.at(-1)!.id, value); },
    reject: (status: number) => { rejection = status; },
    cursor: () => cursor,
    async tool(name = 'insert_text') {
      const turn = starts.at(-1)!, args = { markdown: 'Late mutation after Stop.', title: 'Late created page' };
      if (turn.provider === 'codex') await line(turn.id, { id: 20 + events.length, method: 'item/tool/call', params: { tool: name, callId: 'late-tool', arguments: args } });
      else await line(turn.id, { type: 'control_request', request_id: 'late-tool', request: { subtype: 'mcp_message', message: { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name, arguments: args } } } });
      return events.length;
    },
    async approval() {
      await line(starts.at(-1)!.id, { type: 'control_request', request_id: 'late-approval', request: { subtype: 'can_use_tool', tool_name: 'mcp__notes__insert_text', tool_use_id: 'late-approval', input: { markdown: 'Late mutation after Stop.' } } });
      return events.length;
    },
    readiness: () => `Claude Code: ${ready ? 'signed in' : 'not installed'} · Codex: ${codex && ready ? 'signed in' : 'sign in on your Mac'}`,
    ready: async () => { ready = true; await publishStatus(); },
    switchAccount: () => { user = 'another-workspace-user'; },
    delayAccount() {
      let release!: () => void, started!: () => void;
      const received = new Promise<void>((resolve) => { started = resolve; });
      delayedAccount = { started, released: new Promise<void>((resolve) => { release = resolve; }) };
      return { received, release };
    },
    delayTool() {
      let release!: () => void, started!: () => void;
      const received = new Promise<void>((resolve) => { started = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      delayedPoll = { started, released };
      return { received, release };
    },
    hold: () => { mode = 'hold'; },
    hasCancel: () => Boolean(cancel),
    stop: async () => { await cancel?.(); },
    async terminal() {
      const turn = starts.at(-1)!;
      await line(turn.id, turn.provider === 'codex' ? { method: 'turn/completed', params: { turn: { status: 'completed' } } } : { type: 'result', result: 'Finished during cancellation.', session_id: 'late-session', is_error: false });
      return events.length;
    },
    stopped: () => emit(starts.at(-1)!.id, { type: 'ended', how: 'stopped' }),
    offline: () => { offline = true; pair!.lastSeen = new Date(Date.now() - 40_000).toISOString(); },
    online: () => { offline = false; pair!.lastSeen = new Date().toISOString(); },
    async approve(code: string) {
      const [, id, encoded] = code.split(':');
      expect(id).toBe(pair!.id);
      key = await crypto.subtle.importKey('raw', Buffer.from(encoded, 'base64url'), 'AES-GCM', false, ['encrypt', 'decrypt']);
      pair!.state = 'active'; pair!.macName = 'Test Mac'; pair!.lastSeen = new Date().toISOString();
      await publishStatus();
    },
  };
}
async function connect(page: Page, mac: Awaited<ReturnType<typeof pairedMac>>, url = '/') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a Mac', exact: true }).click();
  const code = await page.getByLabel('Pairing code', { exact: true }).inputValue();
  expect(JSON.stringify(mac.wire)).not.toContain(code);
  expect(JSON.stringify(mac.wire)).not.toContain(code.split(':')[2]);
  await expect(page.getByText('Connect in the Mac app', { exact: true })).toBeVisible();
  await mac.approve(code);
  await page.getByRole('button', { name: 'Refresh connections' }).click();
  await expect(page.getByText(mac.readiness(), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this Mac', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connected', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Paired note');
  await page.getByRole('textbox', { name: 'Page body' }).fill('My original words.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Question' })).toBeVisible();
}

// Seam: restoring the account and pairing must not briefly mount a different composer and lose its draft.
for (const mode of ['development', 'production'] as const) test(`${mode} iPad reload waits for its Mac and preserves an offline draft`, async ({ page }) => {
  test.skip(mode === 'production' && !process.env.OFFLINE_QA, 'Requires a fresh production build at OFFLINE_QA.');
  await page.setViewportSize({ width: 820, height: 1180 });
  const mac = await pairedMac(page); await connect(page, mac, mode === 'production' ? process.env.OFFLINE_QA! : '/');
  await page.addInitScript(() => {
    const state = (window as any).hydrationScreens = { released: false, unpaired: false, prematureComposer: false };
    new MutationObserver(() => {
      const panel = document.querySelector('[data-testid="agent-panel"]');
      state.unpaired ||= panel?.textContent?.includes('Agents work on your Mac') ?? false;
      state.prematureComposer ||= !state.released && !!panel?.querySelector('[aria-label="Question"]');
    }).observe(document, { childList: true, subtree: true });
  });
  const held = mac.delayAccount();
  await page.reload({ waitUntil: 'domcontentloaded' }); await held.received;
  const panel = page.getByRole('region', { name: 'Agent', exact: true });
  await expect(panel).toContainText('Loading your Mac connection');
  await expect(panel.getByRole('textbox', { name: 'Question' })).toHaveCount(0);
  await page.evaluate(() => { (window as any).hydrationScreens.released = true; }); held.release();
  const question = panel.getByRole('textbox', { name: 'Question' });
  await expect(question).toBeVisible({ timeout: 2500 });
  await expect(panel).toContainText('Test Mac');
  expect(await page.evaluate(() => (window as any).hydrationScreens)).toMatchObject({ unpaired: false, prematureComposer: false });
  await question.fill('Keep my iPad draft after this reload.');
  await page.getByRole('button', { name: 'Use this Mac', exact: true }).click();
  await page.getByRole('button', { name: 'Take over connection', exact: true }).click();
  await expect(panel).toContainText('Connected. Agents use your Mac');
  mac.offline();
  await expect(panel).toContainText('Offline — open LeadingLight', { timeout: 10_000 });
  await expect(question).toHaveText('Keep my iPad draft after this reload.');
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.screenshot({ path: `qa/report/pairing-${mode}-ipad-hydrated-${test.info().project.name}.png`, animations: 'disabled' });
});

test('refused starts keep the connection and never send a cancellation', async ({ page }) => {
  const mac = await pairedMac(page); await connect(page, mac);
  const panel = page.getByRole('region', { name: 'Agent', exact: true });
  for (const status of [429, 409, 413]) {
    mac.reject(status);
    await page.getByRole('textbox', { name: 'Question' }).fill(`A request rejected with ${status}.`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(panel).toContainText(`Start refused with ${status}.`);
    await expect(panel).toContainText('Connected. Agents use your Mac');
    await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  }
  expect(mac.starts).toHaveLength(0);
  expect(mac.wire.filter((body: any) => body.kind === 'start')).toHaveLength(3);
  expect(mac.wire.filter((body: any) => body.kind === 'cancel')).toHaveLength(0);
  await expect(panel).not.toContainText('stops this turn within a minute');
});

test('clock skew does not expire a fresh code or misclassify Mac liveness', async ({ page }) => {
  await page.clock.setFixedTime(new Date(Date.now() + 10 * 60_000));
  const mac = await pairedMac(page); await connect(page, mac);
  const panel = page.getByRole('region', { name: 'Agent', exact: true });
  await page.getByRole('textbox', { name: 'Question' }).fill('A draft across clock differences.');
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.clock.setFixedTime(new Date(Date.now() - 90_000));
  mac.offline(); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(panel).toContainText('Offline — open LeadingLight');
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  mac.online(); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(panel).toContainText('Connected. Agents use your Mac');
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

test('paired Mac streams, edits once, and another Mac receives fresh context', async ({ page }) => {
  test.setTimeout(60_000);
  const mac = await pairedMac(page); await connect(page, mac);
  await page.getByRole('textbox', { name: 'Question' }).fill('Add a sentence.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Reply from your Mac.');
  await expect(page.getByRole('textbox', { name: 'Page body' })).not.toContainText('One approved addition.');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page body' })).toContainText('One approved addition.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Stop|Stopping)$/ })).toHaveCount(0);
  expect((await page.getByRole('textbox', { name: 'Page body' }).innerText()).match(/One approved addition/g)).toHaveLength(1);
  expect(mac.starts).toHaveLength(1);
  expect(JSON.stringify(mac.wire)).not.toContain('My original words');
  await expect(page.locator('[data-origin="agent"]')).toContainText(['One approved addition.']);
  await page.screenshot({ path: 'qa/report/paired-mac-approval.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a Mac', exact: true }).click();
  await mac.approve(await page.getByLabel('Pairing code', { exact: true }).inputValue());
  await page.getByRole('button', { name: 'Refresh connections' }).click();
  await page.getByRole('button', { name: 'Use this Mac', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  mac.hold();
  await page.getByRole('textbox', { name: 'Question' }).fill('Continue on another Mac.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => mac.starts.length).toBe(2);
  expect(mac.starts[1].resume).toBeUndefined();
  expect(mac.starts[1].prompt).toContain('My original words.');
  expect(mac.starts[1].prompt).toContain('One approved addition.');
});

test('paired Codex uses its model catalog and gates a page tool before editing once', async ({ page }) => {
  const mac = await pairedMac(page, true); await connect(page, mac);
  await page.getByRole('button', { name: 'Model and effort' }).click();
  await page.getByRole('radio', { name: /GPT-6.1-Sol/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Question' }).fill('Add a sentence with Codex.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => mac.replies.length, { timeout: 10_000 }).toBe(2);
  await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Codex from your Mac.');
  await expect(page.getByRole('textbox', { name: 'Page body' })).not.toContainText('One approved Codex addition.');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  expect((await page.getByRole('textbox', { name: 'Page body' }).innerText()).match(/One approved Codex addition/g)).toHaveLength(1);
  expect(mac.starts.map((request) => request.provider)).toEqual(['codex']);
  expect(mac.replies.map((reply) => reply.method ?? reply.id)).toEqual(['thread/start', 'turn/start', 9]);
  expect(mac.replies[0].params.sandbox).toBe('read-only');
  expect(mac.replies[1].params.input[0].text).toContain('My original words.');
  expect(mac.replies[2].result.success).toBe(true);
  expect(JSON.stringify(mac.wire)).not.toContain('My original words.');
});

// Seam: Codex messages can interleave, finish without a start, or precede a late work item.
test('Codex message ids and phases keep the final answer visible after work and reload', async ({ page }) => {
  const mac = await pairedMac(page, true); await connect(page, mac); mac.hold();
  await page.getByRole('button', { name: 'Model and effort' }).click();
  await page.getByRole('radio', { name: /GPT-6.1-Sol/ }).click(); await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Question' }).fill('Answer without changing my note.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Agent', exact: true });
  await expect.poll(() => mac.replies.length, { timeout: 10_000 }).toBe(2);
  await expect(panel).toContainText('Codex from your Mac.');
  await mac.codexEvents([
    { method: 'item/completed', params: { item: { type: 'agentMessage', id: 'partial', phase: 'partial_answer', text: 'A stable partial answer.' } } },
    { method: 'item/agentMessage/delta', params: { itemId: 'final', delta: 'A streamed draft.' } },
    { method: 'item/agentMessage/delta', params: { itemId: 'codex-answer', delta: ' Still working.' } },
    { method: 'item/completed', params: { item: { type: 'agentMessage', id: 'final', phase: 'final_answer', text: 'The completed final answer.' } } },
    { method: 'item/started', params: { item: { type: 'reasoning', id: 'late-work' } } },
    { method: 'item/completed', params: { item: { type: 'reasoning', id: 'late-work', summary: ['A late work summary.'] } } },
    { method: 'item/completed', params: { item: { type: 'agentMessage', id: 'empty', phase: 'final_answer', text: '' } } },
    { method: 'turn/completed', params: { turn: { status: 'completed' } } },
  ]);
  await expect(panel.getByText('The completed final answer.', { exact: true })).toBeVisible();
  await expect(panel.getByText('A stable partial answer.', { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('A streamed draft.');
  await expect(panel.getByText('Codex from your Mac. Still working.', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: /^Worked/ }).click();
  await expect(panel.getByText('Codex from your Mac. Still working.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByText('The completed final answer.', { exact: true })).toBeVisible();
  await expect(panel.getByText('Codex from your Mac. Still working.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).copiedAnswer = text; } }, configurable: true }); });
  await panel.getByRole('button', { name: 'Copy the answer', exact: true }).click();
  expect(await page.evaluate(() => (window as any).copiedAnswer)).toBe('The completed final answer.');
  await panel.getByRole('button', { name: 'Insert below', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page body' })).toContainText('The completed final answer.');
  await expect(page.getByRole('textbox', { name: 'Page body' })).not.toContainText('Still working');
  await page.screenshot({ path: `qa/report/paired-codex-final-answer-${test.info().project.name}.png`, animations: 'disabled' });
});

test('CLI readiness refreshes without reopening Ask or losing the draft', async ({ page }) => {
  const mac = await pairedMac(page, true, false); await connect(page, mac);
  const question = page.getByRole('textbox', { name: 'Question' });
  await question.fill('Keep this while my Mac checks its agents.');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await mac.ready();
  await page.evaluate(async () => (await import('/src/lib/' + 'remote.ts')).refreshPairs());
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(question).toContainText('Keep this while my Mac checks its agents.');
  await page.getByRole('button', { name: 'Model and effort' }).click();
  await expect(page.getByRole('radio', { name: /GPT-6.1-Sol/ })).toBeVisible();
  expect(mac.starts).toHaveLength(0);
});

// Seam: a target change while mentioned pages load must not send a previous Mac's session.
test('removing a Mac while a question is prepared sends nothing', async ({ page }) => {
  const mac = await pairedMac(page); await connect(page, mac);
  await page.evaluate(async () => {
    localStorage.setItem('ll.threads.preparing', JSON.stringify([{ id: 'preparing-thread', title: '', items: [], updated: Date.now(), seen: {}, allowed: [] }]));
    const pages = new Promise<[]>((resolve) => { (window as any).finishPageRead = () => resolve([]); });
    void (await import('/src/lib/' + 'turn.ts')).sendTurn({ page: { id: 'preparing', title: () => 'Prepared note', text: () => 'Private context.' }, threadId: 'preparing-thread', question: 'Wait for mentioned pages.', quote: null, pages });
  });
  await expect.poll(() => page.evaluate(async () => Boolean((await import('/src/lib/' + 'threads.ts')).threadOf('preparing', 'preparing-thread').busy))).toBe(true);
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Remove connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove connection', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).finishPageRead());
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'threads.ts')).threadOf('preparing', 'preparing-thread').items.at(-1))).toMatchObject({ kind: 'end', how: 'failed', error: expect.stringContaining('Nothing was sent') });
  expect(mac.starts).toHaveLength(0);
});

test('offline preserves draft, Stop waits for Mac, and reload interrupts without replay', async ({ page }) => {
  const mac = await pairedMac(page); mac.hold(); await connect(page, mac);
  const question = page.getByRole('textbox', { name: 'Question' });
  await question.fill('Keep my draft.');
  mac.offline(); await page.evaluate(async () => (await import('/src/lib/' + 'remote.ts')).refreshPairs());
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(question).toContainText('Keep my draft.');
  expect(mac.starts).toHaveLength(0);
  mac.online(); await page.evaluate(async () => (await import('/src/lib/' + 'remote.ts')).refreshPairs());
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Reply from your Mac.');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
  await expect.poll(() => mac.starts.length).toBe(1);
  await expect.poll(mac.hasCancel).toBe(true);
  await mac.stop();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Stop|Stopping)$/ })).toHaveCount(0);
  await question.fill('A second question.'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => mac.starts.length).toBe(2);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Connection interrupted when this browser reloaded');
  await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Reply from your Mac.');
  expect(mac.starts).toHaveLength(2);
  await page.getByRole('button', { name: 'Use this Mac', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take over connection' })).toBeVisible();
  expect(mac.starts).toHaveLength(2);
});

// Seam: a response started by the previous account must not mutate notes after an account change.
test('changing workspace account drops an in-flight encrypted tool response', async ({ page }) => {
  const mac = await pairedMac(page); mac.hold(); await connect(page, mac);
  await page.getByRole('textbox', { name: 'Question' }).fill('Wait for my next instruction.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Reply from your Mac.');
  const delayed = mac.delayTool(); await delayed.received;
  mac.switchAccount();
  await page.evaluate(async () => {
    await (await import('/src/lib/' + 'cloud.ts')).refreshCloud();
    await (await import('/src/lib/' + 'remote.ts')).refreshPairs();
  });
  const oldResponse = page.waitForResponse((response) => response.url().includes('/events?'));
  delayed.release(); await (await oldResponse).finished();
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'remote.ts')).remoteState())).toMatchObject({ pairs: [], selected: null, connected: false });
  await expect(page.getByRole('textbox', { name: 'Page body' })).toHaveText('My original words.');
  await expect(page.getByRole('region', { name: 'Agent', exact: true })).toContainText('Your workspace account changed');
  expect(mac.starts).toHaveLength(1);
});

// Seam: Stop freezes local tools before the remote process acknowledges cancellation.
for (const [provider, access] of [['Claude', 'Approve for me'], ['Codex', 'Full access']] as const) {
  test(`Stop blocks late ${provider} tools and approvals with ${access}`, async ({ page }) => {
    const mac = await pairedMac(page, provider === 'Codex'); mac.hold(); await connect(page, mac);
    if (provider === 'Codex') {
      await page.getByRole('button', { name: 'Model and effort' }).click();
      await page.getByRole('radio', { name: /GPT-6.1-Sol/ }).click(); await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: 'Access: Ask for approval', exact: true }).click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${access}`) }).click();
    await page.getByRole('textbox', { name: 'Question' }).fill('Work until I stop.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    if (provider === 'Codex') await expect.poll(() => mac.replies.length, { timeout: 10_000 }).toBe(2);
    else await expect.poll(() => mac.starts.length).toBe(1);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
    await expect.poll(mac.hasCancel).toBe(true);
    if (provider === 'Claude') await mac.approval();
    await mac.tool(); const last = await mac.tool('create_page');
    await expect.poll(mac.cursor, { timeout: 10_000 }).toBeGreaterThanOrEqual(last);
    await expect(page.getByRole('group', { name: 'Approval' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Page body' })).toHaveText('My original words.');
    await expect(page.getByRole('navigation', { name: 'Recent' })).not.toContainText('Late created page');
    await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
    const terminal = await mac.terminal();
    await expect.poll(mac.cursor, { timeout: 10_000 }).toBeGreaterThanOrEqual(terminal);
    await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
    await mac.stopped();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  });
}

for (const change of ['Stop', 'Changing workspace account'] as const) test(`${change} prevents a received page tool from mutating after pending saves finish`, async ({ page }) => {
  const mac = await pairedMac(page); mac.hold(); await connect(page, mac);
  await page.getByRole('textbox', { name: 'Question' }).fill('A slow-save edit.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => mac.starts.length).toBe(1);
  await page.evaluate(async () => {
    const state = (window as any).heldSave = { reached: false, release: () => {}, remove: () => {} };
    const wait = new Promise<void>((resolve) => { state.release = resolve; });
    state.remove = (await import('/src/lib/' + 'saving.ts')).trackFlush(() => { state.reached = true; return wait; });
  });
  await mac.tool();
  await expect.poll(() => page.evaluate(() => (window as any).heldSave.reached), { timeout: 10_000 }).toBe(true);
  if (change === 'Stop') {
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stopping', exact: true })).toBeDisabled();
  } else {
    mac.switchAccount();
    await page.evaluate(async () => (await import('/src/lib/' + 'cloud.ts')).refreshCloud());
  }
  await page.evaluate(async () => { const held = (window as any).heldSave; held.remove(); held.release(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await expect(page.getByRole('textbox', { name: 'Page body' })).toHaveText('My original words.');
  if (change === 'Stop') {
    const last = await mac.tool();
    await expect.poll(mac.cursor, { timeout: 10_000 }).toBeGreaterThanOrEqual(last);
    await expect.poll(mac.hasCancel).toBe(true); await mac.stop();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  }
});
