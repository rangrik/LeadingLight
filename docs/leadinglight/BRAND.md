# LeadingLight identity

The mark is a bright ivory lighthouse with a coral roof, a warm amber lamp and a soft
beam over a pale sky-blue tile. The open, light palette makes the application easy to
recognize in the Dock without a dark background.

- Master: `src/assets/leadinglight-icon.png`, original generated RGBA artwork.
- Native exports: `src-tauri/icons/`, generated with `pnpm tauri icon src/assets/leadinglight-icon.png`.
- In-app use: local welcome screen and browser favicon use the same master.
- Palette: ivory, powder blue, coral and honey gold.

The production artwork was created with built-in image generation on 2026-10-15, then
refined once for clean outer transparency and simpler detail. Native sizes are deterministic
exports of that master; the artwork was not reconstructed with a different silhouette.
The 256px, 64px and 32px exports were checked on light and dark browser surfaces;
the outer transparency renders cleanly and the small lighthouse remains recognizable.

Generation brief: an original, optimistic macOS notes-app icon; a tapered ivory lighthouse,
coral roof, warm amber lantern and one pale-gold beam; a light powder-blue and ivory rounded
tile with gentle satin depth and transparent outer padding. No lettering, dark forest tile,
night scene, torch, flame, folded page or decorative sparkle. The refinement preserved the
composition while simplifying the base and cleaning the outer transparency.

See `src/assets/leadinglight-icon.LICENSE` for artwork licensing. Retained upstream branding
assets remain in historical source where needed for merges; they are not this app's identity.
