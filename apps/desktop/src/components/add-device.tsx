import { useState } from 'react';
import { Button } from '@leadinglight/ui/components/button';
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@leadinglight/ui/components/dialog';
import { Field, FieldLabel } from '@leadinglight/ui/components/field';
import { Form } from '@leadinglight/ui/components/form';
import { OTPField, OTPFieldInput } from '@leadinglight/ui/components/otp-field';
import { accountLine, type Account } from '~/lib/cloud';
import { approveNativeAccount, connectionCode, findNativeApproval, type NativeApproval } from '~/lib/native-account';
import { syncKey } from '~/lib/sync';

const slots = Array.from({ length: 8 }, (_, slot) => slot);
// Focus lands on the sentence, not the button, so a held Enter key cannot approve a device unread.
const focus = (node: HTMLElement | null) => node?.focus();
const spaced = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

// Add a device from one that syncs: type the new device's code, read what it is, approve.
export function AddDeviceDialog({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange(open: boolean): void }) {
  const [code, setCode] = useState(''), [device, setDevice] = useState<NativeApproval>(), [joined, setJoined] = useState('');
  // A wrong code is cleared and the first box takes focus, so the next try is typed, not patched.
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const find = () => { if (!busy && code.length === 8) void run(async () => { try { setDevice(await findNativeApproval(code)); } catch (e) { setCode(''); setAttempt(attempt + 1); throw e; } }); };
  const approve = (waiting: NativeApproval) => void run(async () => {
    try { await approveNativeAccount(waiting, account.id, syncKey()); setJoined(waiting.deviceName); }
    finally { setDevice(undefined); setCode(''); }
  });
  const close = (next: boolean) => { if (!next) { setCode(''); setDevice(undefined); setJoined(''); setError(''); } onOpenChange(next); };
  return <Dialog onOpenChange={close} open={open}>
    <DialogPopup>
      {joined ? <>
        <DialogHeader><DialogTitle>Device added</DialogTitle><DialogDescription ref={focus} tabIndex={-1} className="outline-none">{joined} is connected. It will finish syncing by itself.</DialogDescription></DialogHeader>
        <DialogFooter><Button onClick={() => setJoined('')} variant="ghost">Add another</Button><DialogClose render={<Button />}>Done</DialogClose></DialogFooter>
      </> : device ? <>
        <DialogHeader><DialogTitle>Let {device.deviceName} open your notes?</DialogTitle><DialogDescription>{accountLine(account) || account.name}</DialogDescription></DialogHeader>
        <DialogPanel className="space-y-4">
          <p className="rounded-lg bg-muted py-4 text-center font-mono font-semibold text-2xl tracking-[0.14em]">{spaced(connectionCode(device.id))}</p>
          <p className="break-words text-sm outline-none" ref={focus} tabIndex={-1}>It will sign in to this account and get the key for your encrypted notes. Approve only if you are setting up that device and it shows this code.</p>
        </DialogPanel>
        <DialogFooter><Button onClick={() => setDevice(undefined)} variant="ghost">Back</Button><Button disabled={busy} onClick={() => approve(device)}>Approve</Button></DialogFooter>
      </> : <Form className="contents" onSubmit={(event) => { event.preventDefault(); find(); }}>
        <DialogHeader><DialogTitle>Add a device</DialogTitle><DialogDescription>Do this on the new Mac, iPad or iPhone, then type its code here.</DialogDescription></DialogHeader>
        <DialogPanel className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Open LeadingLight there and go to Settings, then Account and devices.</li>
            <li>Press Connect. It shows a code of 8 characters.</li>
          </ol>
          <Field>
            <FieldLabel>Code from the new device</FieldLabel>
            <OTPField autoComplete="off" className="min-w-0 max-sm:gap-1" key={attempt} length={8} normalizeValue={(value) => value.replace(/[^\da-f]/gi, '').toUpperCase()} onValueChange={setCode} validationType="alphanumeric" value={code}>
              {slots.map((slot) => <OTPFieldInput aria-label={slot ? `Character ${slot + 1} of 8` : undefined} autoFocus={!slot} key={slot} />)}
            </OTPField>
          </Field>
          {error && <p className="text-destructive-foreground text-sm" role="alert">{error}</p>}
        </DialogPanel>
        <DialogFooter><DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose><Button disabled={code.length !== 8 || busy} type="submit">Continue</Button></DialogFooter>
      </Form>}
    </DialogPopup>
  </Dialog>;
}
