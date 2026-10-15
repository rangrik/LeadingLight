# LeadingLight identity

The mark is a page opening into light. A flowing gap through the ivory page leads toward a
sage fold and a small amber opening. The dark forest tile keeps the silhouette clear in the
Dock and in light or dark interfaces. It replaces the temporary stock lighthouse icon.

- Master: `src/assets/leadinglight-icon.svg` — a clean, scalable source asset.
- Native exports: `src-tauri/icons/`, generated with `pnpm tauri icon src/assets/leadinglight-icon.svg`.
- In-app use: local welcome screen and browser favicon both use the master.
- Palette: forest `#263C34`, ivory `#F7F6F3`, sage `#8FA68E`, amber `#E8BE76`.

A built-in image-generation concept informed the silhouette. The production artwork is a
vector reconstruction, with opaque flat fills and transparent outer padding; no generated
raster texture or transparency artifacts are shipped. Both the 32px icon and 256px export
were visually checked.

Generation brief: a calm notes app icon, an upright ivory page turning into a sage fold,
a curved opening toward warm light, dark forest rounded tile, strong small-size silhouette,
no text, lighthouse, rays, sparkle, or ornamental detail.

See `src/assets/leadinglight-icon.LICENSE` for artwork licensing. Retained upstream branding
assets remain in historical source where needed for merges; they are not this app's identity.
