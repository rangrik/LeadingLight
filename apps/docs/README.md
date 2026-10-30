# LeadingLight docs

The user and developer documentation, built with [VitePress](https://vitepress.dev) (MIT).
Pages are Markdown in the folders here; the sidebar is in `.vitepress/config.mts`.

```sh
pnpm --filter @leadinglight/docs dev      # http://127.0.0.1:1440
pnpm --filter @leadinglight/docs build    # writes .vitepress/dist
pnpm --filter @leadinglight/docs preview
```

The build fails on a link to a page that doesn't exist, so run it after moving pages.

## Writing

- The specs in `features/` are the contract: document what they say the app does, and nothing more.
- Plain English, second person, the app's own labels in **bold**, keys as `<kbd>⇧⌘F</kbd>`.
- Mark features that exist in one place only with `<Badge type="info" text="Mac app" />`, and
  previews with `<Badge type="warning" text="Preview" />`.
- Screenshots are WebP in `public/screenshots/`, 1600×1000, taken from the browser build
  (`pnpm --filter @leadinglight/desktop dev`) at 1280×800 and twice the pixel density.
  Show them with `<img class="shot" src="/screenshots/<name>.webp" alt="…" />`.

## Deploying to Vercel

Create a Vercel project from this repository with **Root Directory** `apps/docs`.
`vercel.json` here sets everything else: the VitePress preset, an install of only this
package's dependencies, the build, and `.vitepress/dist` as the output. No environment
variables or secrets are needed. This is a separate project from the web app (the root
`vercel.json`) and from `apps/image-service`.
