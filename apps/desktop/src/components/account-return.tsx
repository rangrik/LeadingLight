// COSS Empty composition follows BrowserAddressEntry, with its normal Button link.
import { useEffect, useRef } from 'react';
import { Button } from '@leadinglight/ui/components/button';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from '@leadinglight/ui/components/empty';
import { appReturnUrl, browserReturn } from '~/lib/account-return';

export function AccountReturn() {
  const returned = browserReturn(new URL(location.href)), launched = useRef(false);
  const href = returned ? appReturnUrl(returned) : '';
  useEffect(() => {
    if (href && !launched.current) { launched.current = true; location.href = href; }
  }, [href]);
  return <Empty className="mx-auto min-h-svh max-w-xl p-6"><EmptyHeader>
    <EmptyTitle>{!returned ? 'This return link is invalid' : returned.result === 'cancelled' ? 'Connection cancelled' : `${returned.integration === 'gmail' ? 'Mail' : 'Calendar'} connected`}</EmptyTitle>
    <EmptyDescription>{!returned ? 'Return to LeadingLight and start connecting again.' : 'Return to LeadingLight to continue. If it did not open automatically, use the button below.'}</EmptyDescription>
  </EmptyHeader>{returned && <EmptyContent><Button render={<a href={href} />}>Open LeadingLight</Button></EmptyContent>}</Empty>;
}
