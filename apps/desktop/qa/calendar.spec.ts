import { expect, test } from '@playwright/test';

// Seam: the visible form must send the intended Google write and keep failed drafts intact.
test('calendar agenda, focus, edits, conflict, recurring occurrence and visibility', async ({ page }) => {
  await page.clock.setFixedTime(new Date(new Date().setHours(9, 0, 0, 0)));
  const today = new Date(); today.setHours(10, 0, 0, 0);
  const end = new Date(today.getTime() + 30 * 60000);
  let events = [{ id: 'one', etag: '"v1"', summary: 'Creative work', start: { dateTime: today.toISOString() }, end: { dateTime: end.toISOString() }, recurringEventId: 'series' }];
  const writes: { action: string; body: any }[] = []; let conflict = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    let result: unknown = {};
    if (path === '/api/config') result = { ready: true, allowed: true, providers: [] };
    else if (path === '/api/me') result = { id: 'test-owner', name: 'Test owner' };
    else if (path === '/api/calendar/accounts') result = { accounts: [{ account: 'personal', email: 'me@example.test' }, { account: 'work', email: 'work@example.test' }] };
    else if (path === '/api/calendar/calendars') result = { calendars: [{ id: body.account, summary: body.account === 'personal' ? 'Life' : 'Work', accessRole: 'owner', primary: true, timeZone: 'America/Los_Angeles' }] };
    else if (path === '/api/calendar/events') result = { events: body.account === 'personal' ? events : [] };
    else if (/\/calendar\/(create|update|delete)$/.test(path)) {
      writes.push({ action: path.split('/').pop()!, body });
      if (conflict) return route.fulfill({ status: 412, json: { error: 'This event changed in Google. Refresh and reopen it before saving.' } });
      if (path.endsWith('/create')) events.push({ id: 'two', etag: '"v2"', ...body.details });
      if (path.endsWith('/update')) events[0] = { ...events[0], ...body.details };
      if (path.endsWith('/delete')) events = events.filter((e) => e.id !== body.event);
      result = { event: events[0] };
    }
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Creative work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Creative work', exact: true }).click();
  await expect(page.getByText('Changes apply only to this occurrence.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Gentle creative work');
  conflict = true;
  await page.getByRole('button', { name: 'Save to Google' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in Google');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Gentle creative work');
  expect(writes[0].body.etag).toBe('"v1"'); expect(writes[0].body.event).toBe('one');
  conflict = false;
  await page.getByRole('button', { name: 'Save to Google' }).click();
  await expect(page.getByRole('button', { name: 'Gentle creative work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Time outside');
  await page.getByRole('checkbox', { name: 'All day' }).check();
  await page.screenshot({ path: 'qa/report/calendar-event-form.png', fullPage: true });
  await page.getByRole('button', { name: 'Details, repeat and reminders' }).click();
  await page.getByRole('combobox', { name: 'Repeat', exact: true }).click();
  await page.getByRole('option', { name: 'Weekly', exact: true }).click();
  await page.getByRole('combobox', { name: 'Reminder', exact: true }).click();
  await page.getByRole('option', { name: '10 minutes before', exact: true }).click();
  await page.getByRole('button', { name: 'Save to Google' }).click();
  await expect(page.getByRole('button', { name: 'Time outside', exact: true })).toBeVisible();
  const create = writes.find((w) => w.action === 'create')!.body;
  expect(create.details.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=12']);
  expect(create.details.reminders.overrides).toEqual([{ method: 'popup', minutes: 10 }]);
  expect(create.requestId).toBeTruthy(); expect(create.details.start.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(create.details.start.dateTime).toBeUndefined();
  await page.getByRole('button', { name: 'Calendars', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Life', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Time outside', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Plan 25 minutes of focus' }).click();
  await expect(page.getByRole('combobox', { name: 'Calendar', exact: true })).toContainText('Work');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('tab', { name: 'Next 7 days' }).click();
  await expect(page.locator('[data-testid="calendar-view"] h2')).toHaveCount(7);
  await page.screenshot({ path: 'qa/report/calendar-week.png', fullPage: true });
  await page.getByRole('button', { name: 'Calendars', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Life', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Day', exact: true }).click();
  await page.getByRole('button', { name: 'Gentle creative work', exact: true }).click();
  await page.getByRole('button', { name: 'Delete event' }).click();
  await expect(page.getByText('Delete this occurrence from Google Calendar? Guests will be notified.')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByRole('button', { name: 'Gentle creative work', exact: true })).not.toBeVisible();
  await page.screenshot({ path: 'qa/report/calendar-day.png', fullPage: true });
});

test('calendar works in a narrow pane and offers sign-in without fake events', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', (r) => r.fulfill({ json: { ready: false, providers: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in to connect calendars' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'qa/report/calendar-mobile.png', fullPage: true });
});

// Seam: stale or read-only schedules cannot be mistaken for confirmed writable time.
test('focus, read-only events, stale refresh and account changes stay explicit', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00'));
  const at = new Date('2026-11-03T10:00:00').toISOString(), until = new Date('2026-11-03T10:30:00').toISOString();
  let failRefresh = false;
  const creates: any[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    let data: unknown = {};
    if (path === '/api/config') data = { ready: true, providers: [], allowed: true };
    else if (path === '/api/me') data = { id: 'qa-owner', name: 'QA owner' };
    else if (path === '/api/calendar/accounts') data = { accounts: [{ account: 'one', email: 'one@example.test' }] };
    else if (path === '/api/calendar/calendars') data = { calendars: [{ id: 'writable', summary: 'Personal', accessRole: 'owner', primary: true }, { id: 'readonly', summary: 'Team', accessRole: 'reader' }] };
    else if (path === '/api/calendar/events') {
      if (failRefresh) return route.fulfill({ status: 503, json: { error: 'Google is temporarily unavailable.' } });
      data = { events: body.calendar === 'readonly' ? [{ id: 'shared', etag: '"v1"', summary: 'Team planning', start: { dateTime: at }, end: { dateTime: until } }] : [] };
    } else if (path === '/api/calendar/create') { creates.push(body); data = { event: { id: 'focus' } }; }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Team planning', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Team planning', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save to Google' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete event' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Plan 25 minutes of focus' }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Focus time');
  await page.getByRole('button', { name: 'Save to Google' }).click();
  expect(creates).toHaveLength(1);
  expect(Date.parse(creates[0].details.end.dateTime) - Date.parse(creates[0].details.start.dateTime)).toBe(25 * 60_000);
  failRefresh = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('may be out of date');
  await expect(page.getByRole('button', { name: 'Team planning', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan 25 minutes of focus' })).toBeDisabled();
  await page.screenshot({ path: 'qa/report/calendar-stale.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'qa/report/calendar-mobile-connected.png', fullPage: true });
  const overflow = await page.getByTestId('calendar-view').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  const staleAgent = await page.evaluate(async () => {
    const modulePath = '/src/lib/note-tools.ts'; const { runTool } = await import(modulePath);
    return runTool('', 'calendar_create', { account: 'one', calendar: 'writable', requestId: 'old-turn', details: '{}' }, undefined, () => true, 'old-owner');
  });
  expect(staleAgent.isError).toBe(true);
  expect(creates).toHaveLength(1);
  await page.evaluate(async () => { const modulePath = '/src/lib/cloud.ts'; const { setCloud } = await import(modulePath); setCloud({ user: null }); });
  await expect(page.getByRole('button', { name: 'Sign in to connect calendars' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Team planning', exact: true })).toHaveCount(0);
});

test('Google return opens Calendar after workspace restoration', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ json: path === '/api/config' ? { ready: true, allowed: true, providers: [] } : path === '/api/me' ? { id: 'returned-owner', name: 'Returned owner' } : path === '/api/calendar/accounts' ? { accounts: [] } : {} });
  });
  await page.goto('/?calendar=connected');
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByText('Google connected. You can return to the app or plan here.')).toBeVisible();
  await expect(page).not.toHaveURL(/calendar=connected/);
});

// Seam: provider tool requests must pass the real approval and plan-mode gates before Google writes.
test('note agent calendar writes wait for approval and plan mode refuses direct execution', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/calendar/create') writes++;
    await route.fulfill({ json: path === '/api/config' ? { ready: true, allowed: true, providers: [] } : path === '/api/me' ? { id: 'agent-owner', name: 'Agent owner' } : { event: { id: 'created' } } });
  });
  await page.route('**/src/lib/agent-standin.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const runs = new Map();
    const input = {account:'personal', calendar:'primary', requestId:'agent-test', details:JSON.stringify({summary:'Focus',start:{dateTime:'2026-11-03T09:00:00-08:00'},end:{dateTime:'2026-11-03T09:25:00-08:00'}})};
    const tool = (run) => run.emit({type:'control_request',request_id:'execute',request:{subtype:'mcp_message',message:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'calendar_create',arguments:input}}}});
    export function ask(req, onEvent) {
      const run = {emit:line => onEvent({type:'line',line})}; runs.set(req.id,run);
      if(req.access==='plan') tool(run);
      else run.emit({type:'control_request',request_id:'approval',request:{subtype:'can_use_tool',tool_name:'mcp__notes__calendar_create',input,tool_use_id:'call'}});
    }
    export function reply(id, message) {
      const run=runs.get(id); if(!run) return;
      if(message.response?.request_id==='approval') { if(message.response.response.behavior==='allow') tool(run); else run.emit({type:'result',subtype:'success',session_id:'qa'}); }
      if(message.response?.request_id==='execute') { window.__calendarToolResult=message.response.response.mcp_response.result; run.emit({type:'result',subtype:'success',session_id:'qa'}); }
    }
    export function cancel(id) { runs.delete(id); }
  ` }));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('My work');
  await page.getByRole('textbox', { name: 'Title', exact: true }).press('Enter');
  await page.keyboard.press('Meta+J');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Schedule a focus block');
  await page.keyboard.press('Enter');
  const approval = page.getByRole('group', { name: 'Approval' });
  await expect(approval).toBeVisible();
  expect(writes).toBe(0);
  await approval.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(approval).toHaveCount(0);
  await page.evaluate(async () => { const modulePath = '/src/lib/ai-prefs.ts'; const { setAiPrefs } = await import(modulePath); setAiPrefs({ plan: true }); (window as any).__calendarToolResult = null; });
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Plan another focus block');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__calendarToolResult?.isError)).toBe(true);
  expect(writes).toBe(1);
});

test('one expired Google account does not hide healthy calendars', async ({ page }) => {
  const start = new Date(); start.setHours(10, 0, 0, 0);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
    let data: unknown = {};
    if (path === '/api/config') data = { ready: true, allowed: true, providers: [] };
    else if (path === '/api/me') data = { id: 'partial-owner', name: 'Partial owner' };
    else if (path === '/api/calendar/accounts') data = { accounts: [{ account: 'personal', email: 'personal@example.test' }, { account: 'work', email: 'work@example.test' }] };
    else if (path === '/api/calendar/calendars') {
      if (body.account === 'work') return route.fulfill({ status: 401, json: { error: 'Google access expired. Reconnect this account.' } });
      data = { calendars: [{ id: 'primary', summary: 'Personal', accessRole: 'owner' }] };
    } else if (path === '/api/calendar/events') data = { events: [{ id: 'personal-event', etag: '"v1"', summary: 'My healthy calendar event', start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 30 * 60000).toISOString() } }] };
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'My healthy calendar event', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('work@example.test');
  await expect(page.getByRole('button', { name: 'Plan 25 minutes of focus' })).toBeDisabled();
});
