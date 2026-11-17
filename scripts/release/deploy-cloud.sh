#!/usr/bin/env bash
set -euo pipefail

release_source=${1:?Pass the release source checkout}
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN in the cloud-production environment}"
: "${VERCEL_ORG_ID:?Set VERCEL_ORG_ID in the cloud-production environment}"
: "${VERCEL_PROJECT_ID:?Set VERCEL_PROJECT_ID in the cloud-production environment}"
: "${RELEASE_SHA:?Pass the draft release commit}"

if [[ $(git -C "$release_source" rev-parse HEAD) != "$RELEASE_SHA" ]]; then
  echo 'Cloud source does not match the release commit.' >&2
  exit 1
fi

# Vercel builds remotely so production database and OAuth secrets stay there.
pnpm dlx vercel@65.7.0 deploy --cwd "$release_source" --prod --yes \
  --scope "$VERCEL_ORG_ID" --token "$VERCEL_TOKEN" --meta "leadinglightReleaseSha=$RELEASE_SHA"
node "$(dirname "$0")/check-cloud.mjs"
