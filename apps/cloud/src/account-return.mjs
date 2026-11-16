import { NativeError } from './native.mjs';

// Keep the app destination inside the one-use, encrypted OAuth state, never in Google's callback input.
export function connectionContext(verifier, body) {
  if (body.app === undefined && body.id === undefined) return { verifier };
  if (typeof body.app !== 'string' || typeof body.id !== 'string' || !/^leadinglight(?:-dev-[a-f0-9]{6})?$/.test(body.app) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.id)) {
    throw new NativeError(400, 'Invalid app return address. Start connecting again.');
  }
  return { verifier, app: body.app, id: body.id };
}

export function connectionRedirect(env, integration, result, context) {
  const url = new URL(context.app ? '/connect/complete' : '/', env.APP_ORIGIN);
  url.search = new URLSearchParams(context.app
    ? { integration, result, app: context.app, id: context.id }
    : { [integration]: result }).toString();
  return Response.redirect(url, 303);
}
