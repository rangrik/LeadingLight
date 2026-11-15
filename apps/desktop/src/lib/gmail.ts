import { cloudApi, cloudState } from './cloud';
import { isNative } from './platform';

// The service's Gmail routes (apps/cloud/src/gmail.mjs).
export type MailAccount = { account: string; email: string };
export type MailSummary = { id: string; threadId: string; subject: string; from: string; to: string; cc: string; replyTo?: string; date: number; snippet: string; unread: boolean; labels: string[]; unsubscribe: boolean };
export type MailMessage = MailSummary & { text: string; html: string; attachments: { name: string; size: number }[] };
export type MailPage = { messages: MailSummary[]; nextPageToken: string | null };

export async function gmailApi<T>(action: string, body?: unknown): Promise<T> {
  const owner = cloudState().user?.id;
  if (!owner) throw new Error('Sign in to LeadingLight to connect Gmail.');
  const result = await cloudApi<T>(`gmail/${action}`, body, body ? 'POST' : 'GET', owner);
  if (cloudState().user?.id !== owner) throw new Error('The workspace changed. Reopen Mail.');
  return result;
}
export async function connectGmail() {
  const native = await isNative;
  const popup = native ? null : window.open('about:blank', '_blank');
  try {
    const { url } = await gmailApi<{ url: string }>('connect', {});
    if (new URL(url).origin !== 'https://accounts.google.com') throw new Error('Invalid Google connection URL.');
    if (native) await (await import('@tauri-apps/plugin-opener')).openUrl(url);
    else if (popup) { popup.opener = null; popup.location.href = url; }
    else throw new Error('Allow popups to connect Gmail, then try again.');
  } catch (error) { popup?.close(); throw error; }
}

// Gmail opens in the person's browser, never in the app's window.
export async function openExternal(url: string) {
  if (await isNative) await (await import('@tauri-apps/plugin-opener')).openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

// Template contents stay inert and are never attached, so email cannot run code or load images.
export function mailText(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,title,meta,link,base,iframe,object,embed,template,noscript,svg,math,head').forEach((el) => el.remove());
  template.content.querySelectorAll('td,th').forEach((el) => el.append(document.createTextNode('\t')));
  template.content.querySelectorAll('br,p,div,tr,li,h1,h2,h3,h4,blockquote').forEach((el) => el.append(document.createTextNode('\n')));
  return template.content.textContent?.replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || '';
}
