import { useRef, useState, type ReactNode } from 'react';
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from '@leadinglight/ui/components/alert-dialog';
import { Button } from '@leadinglight/ui/components/button';
import { Field, FieldDescription, FieldLabel } from '@leadinglight/ui/components/field';
import { Form } from '@leadinglight/ui/components/form';
import { OTPField, OTPFieldInput } from '@leadinglight/ui/components/otp-field';
import { cloudApi } from '~/lib/cloud';
import { approveNativeAccount, findNativeApproval, type NativeApproval } from '~/lib/native-account';
import { syncEnabled, syncKey } from '~/lib/sync';

const slots = Array.from({ length: 8 }, (_, slot) => slot);
// Focus lands on the sentence, not the button, so a held Enter key cannot approve a device unread.
const focus = (node: HTMLElement | null) => node?.focus();

// The devices on this account: approve a new one by its code, or sign them all out (browser only).
export function DeviceAccess({ account, browser, busy, run, children }: { account: { id: string; name: string }; browser: boolean; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void>; children: ReactNode }) {
  const [code, setCode] = useState(''), [device, setDevice] = useState<NativeApproval>(), [note, setNote] = useState('');
  // After Cancel or a failed approval the person types again, so the first box takes focus.
  const [refocus, setRefocus] = useState(false), [asking, setAsking] = useState(false);
  const status = useRef<HTMLParagraphElement>(null), key = syncKey();
  const find = () => { if (!busy && !device && code.length === 8) void run(async () => { setNote(''); setDevice(await findNativeApproval(code)); }); };
  const approve = (waiting: NativeApproval) => void run(async () => {
    try {
      await approveNativeAccount(waiting, account.id, key);
      setNote(`${waiting.deviceName} is connected. It will finish syncing by itself.`); setRefocus(false);
      status.current?.focus();
    } catch (error) { setRefocus(true); throw error; } finally { setDevice(undefined); setCode(''); }
  });
  return <>
    {/* Only a device that syncs has a key to hand over. */}
    {key && syncEnabled() && <Form onSubmit={(event) => { event.preventDefault(); find(); }}>
      <Field>
        <FieldLabel>Connect another device</FieldLabel>
        {device ? <>
          <p className="max-w-full break-words text-sm outline-none" ref={focus} tabIndex={-1}>{device.deviceName} will connect to {account.name} and receive the key for your encrypted notes.</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => approve(device)} type="button">Connect this device</Button>
            <Button onClick={() => { setDevice(undefined); setRefocus(true); }} type="button" variant="outline">Cancel</Button>
          </div>
        </> : <>
          <div className="flex w-full flex-wrap items-center gap-2">
            <OTPField autoComplete="off" className="min-w-0 max-sm:gap-1" length={8} normalizeValue={(value) => value.replace(/[^\da-f]/gi, '').toUpperCase()} onValueChange={setCode} validationType="alphanumeric" value={code}>
              {slots.map((slot) => <OTPFieldInput aria-label={slot ? `Character ${slot + 1} of 8` : undefined} autoFocus={refocus && !slot} className="size-8 leading-8" key={slot} />)}
            </OTPField>
            <Button disabled={code.length !== 8} type="submit">Continue</Button>
          </div>
          <FieldDescription className="text-sm">On the new Mac or iPad, press Connect your workspace, then type its code here.</FieldDescription>
        </>}
      </Field>
    </Form>}
    <p className={note ? 'text-sm outline-none' : 'sr-only'} ref={status} role="status" tabIndex={-1}>{note}</p>
    <div className="flex flex-wrap items-center gap-2">{children}{browser && <Button disabled={busy} onClick={() => setAsking(true)} variant="outline">Sign out all devices</Button>}</div>
    <AlertDialog onOpenChange={setAsking} open={asking}>
      <AlertDialogPopup className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out all devices?</AlertDialogTitle>
          <AlertDialogDescription>Every Mac, iPad and iPhone app stops syncing until you connect it again. Notes stay on each device, and this browser stays signed in.{!key && ' Connecting the first device again needs your recovery key. Copy it from one of them first: Account and sync, Sync, Show recovery key.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button onClick={() => { setAsking(false); void run(async () => { await cloudApi('native/revoke-all', {}); setNote('Every Mac, iPad and iPhone is signed out. This browser stays signed in.'); }); }} variant="destructive">Sign out all devices</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  </>;
}
