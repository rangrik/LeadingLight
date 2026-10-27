# LeadingLight image service

Two operations in one Vercel Function: `GET /api/photos?query=mountain` searches
Unsplash; `POST /api/photos` reports a selection using the returned `used` token
as its plain-text body. The service never receives notes. Photos load directly
from Unsplash, with photographer and Unsplash links in the app.

Deploy this directory as a Vercel project with framework preset **Other**.
Set `UNSPLASH_ACCESS_KEY` as a production environment variable in Vercel before
deploying. Never use a `VITE_` variable for the key. No Secret Key is needed.
The desktop build defaults to `https://leadinglight-images.vercel.app`; forks can
set `VITE_IMAGE_SERVICE_URL` to their own service origin in
`apps/desktop/.env.local` before building.

Searches are cached by Vercel for one hour. Selection requests are never cached;
their signed tokens expire after one day. Clients cannot choose arbitrary
upstream URLs. Errors and responses never contain credentials.

This is a public service, not authenticated app access: callers can use the search
endpoint and consume its shared quota. Unsplash Demo allows 50 requests/hour.
Apply for Unsplash Production before public rollout; add Vercel Firewall rules
if traffic needs tighter limits. CORS is not an access-control boundary.
Vercel Hobby is for personal, non-commercial projects and pauses at its limits.

Run `pnpm --filter @leadinglight/image-service test` to check the credential and
selection boundary without using Unsplash quota.
