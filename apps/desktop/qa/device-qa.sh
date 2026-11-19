#!/bin/sh
# Runs the device-connections QA against the fixture cloud (qa/device-server.mjs) and a Vite server.
# Usage: qa/device-qa.sh [playwright args], from apps/desktop.
export QA_PORT="${QA_PORT:-14210}" CLOUD_PORT="${CLOUD_PORT:-18788}" CLOUD_QA=1
exec pnpm exec playwright test -c qa/playwright.config.ts --project=qa --reporter=line qa/device-connections.spec.ts "$@"
