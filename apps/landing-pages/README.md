# LeadingLight landing concepts

Three independent landing pages, built with React, Vite, the shared COSS controls,
and original Blender artwork. The desktop application is unchanged.

| Folder | Direction | Main interaction |
| --- | --- | --- |
| `one` | The Reading Room: celadon, paper, editorial spacing | Writing, backlinks, and sources beside a draft |
| `two` | The Cabinet of Curiosities: orange, sculptural specimens, graphic type | Follow an idea to a book, its author, and back |
| `three` | The Light Table: dark optical studio, glass, yellow light | Follow a passing thought through a connection into an essay |

Live versions:

- [The Reading Room](https://leadinglight-reading-room.vercel.app)
- [Cabinet of Curiosities](https://leadinglight-cabinet.vercel.app)
- [The Light Table](https://leadinglight-light-table.vercel.app)

From this folder:

```sh
pnpm dev --mode one --port 1431
pnpm dev --mode two --port 1432
pnpm dev --mode three --port 1433
pnpm typecheck
pnpm build
```

Each build is independent in `dist/one`, `dist/two`, or `dist/three`. Copy
`vercel.static.json` into the selected output as `vercel.json`, link that output
directory to its Vercel project, and deploy it with `vercel --prod --yes`.
Exclude `.env*`, `.vercel`, and `.gitignore` in the output's `.vercelignore`.
Only the built static site is uploaded.

The interactive examples contain illustrative notes. Downloads lead to the
official GitHub releases and disclose the unsigned Apple Silicon preview status.
There are no signup forms or backend services in these landing pages.

Render recipes are in each concept's `artwork/` or `design/` folder. Optimized
website images live in its `public/` folder. Working Blender files and QA captures
are ignored. The behavior contract is `features/landing-pages.feature` at the
repository root.

References explored include [Nendo](https://www.nendo.jp/en/),
[Sublime](https://sublime.app/), [Are.na](https://www.are.na/),
[Apartamento](https://www.apartamentomagazine.com/), and
[Studio Dumbar](https://studiodumbar.com/). They informed the art direction;
the illustrations and page implementations are original.

Validation: full workspace typecheck, production builds, independent agent QA,
keyboard and reduced-motion checks, and desktop/mobile browser checks passed.
The three public deployments returned HTTP 200 with their images loaded and no
uncaught browser errors. Download links target the official releases.
