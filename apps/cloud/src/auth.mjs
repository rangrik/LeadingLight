import { Auth } from '@auth/core';
import { getToken } from '@auth/core/jwt';
import Google from '@auth/core/providers/google';
import GitHub from '@auth/core/providers/github';
import { createHash } from 'node:crypto';

export function authentication(env) {
  const providers = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push(Google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }));
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push(GitHub({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }));
  if (env.CHATGPT_CLIENT_ID) providers.push({ id: 'chatgpt', name: 'ChatGPT', type: 'oidc', issuer: 'https://auth.openai.com', clientId: env.CHATGPT_CLIENT_ID, clientSecret: env.CHATGPT_CLIENT_SECRET, authorization: { params: { scope: 'openid profile email' } }, checks: ['pkce', 'state', 'nonce'], client: { token_endpoint_auth_method: env.CHATGPT_CLIENT_SECRET ? 'client_secret_basic' : 'none' }, profile: (p) => ({ id: p.sub, name: p.name, email: p.email, image: null }) });
  const ready = Boolean(env.AUTH_SECRET?.length >= 32 && env.APP_ORIGIN && env.DATABASE_URL);
  const config = {
    secret: env.AUTH_SECRET, trustHost: true, basePath: '/api/auth', providers,
    session: { strategy: 'jwt', maxAge: 30 * 86400 },
    callbacks: {
      jwt({ token, account }) {
        // Provider subjects, never matching emails, define account ownership.
        if (account) token.sub = createHash('sha256').update(`${account.provider}:${account.providerAccountId}`).digest('hex');
        return token;
      },
      session({ session, token }) { session.user.id = token.sub; return session; },
    },
  };
  return {
    providers: ready ? providers.map((p) => ({ id: p.id, name: p.name })) : [],
    ready,
    handle: (request) => Auth(request, config),
    async user(request) {
      if (!ready) return null;
      const token = await getToken({ req: request, secret: env.AUTH_SECRET, secureCookie: env.APP_ORIGIN.startsWith('https:') });
      return typeof token?.sub === 'string' ? { id: token.sub, name: token.name ?? 'Your account' } : null;
    },
  };
}
