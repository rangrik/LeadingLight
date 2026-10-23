// Pairing links look like berth://100.64.0.1:7444?code=…&fp=…, printed by
// `berthd pair` and by the install script among other lines. People paste
// the whole output, or the link inside quotes from `berth pair '…'`.

const LINK = /berth:\/\/[^\s'"`<>]+/;

// findPairingLink pulls the first pairing link out of pasted text.
export function findPairingLink(text: string): string | undefined {
  const m = LINK.exec(text);
  return m?.[0].replace(/[.,;:)\]]+$/, "");
}

// linkAddress is the address a link tells this computer to dial.
export function linkAddress(link: string): string | undefined {
  return /^berth:\/\/([^/?#]+)/.exec(link)?.[1];
}

// onTailnetAddress reports whether an address is in Tailscale's range
// (100.64.0.0/10), where a box this computer cannot reach is most likely on
// a tailnet it is not signed in to.
export function onTailnetAddress(address: string): boolean {
  const m = /^100\.(\d+)\.\d+\.\d+(:\d+)?$/.exec(address);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

// unreachable reports whether an error means the box did not answer at all,
// as opposed to answering and refusing.
export function unreachable(message: string): boolean {
  return /timed? ?out|deadline|no route|unreachable|connection refused|could not reach|i\/o timeout|no such host/i.test(message);
}
