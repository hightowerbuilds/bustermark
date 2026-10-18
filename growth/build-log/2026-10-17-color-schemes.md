# Color schemes made by the Language Model

Status: **COMPLETED** — verified in the native app on October 17. 687 frontend
tests, 54 path tests, and 71 native tests passed.

The writer describes a color scheme and the Language Model makes it: eight
colors, checked for readability before the writer is asked, previewed on the
approval card, and saved to a gallery in Settings → Appearances. VS Code theme
Import is removed. The plan and its decisions are in
[`growth/phases/color-schemes.md`](../phases/color-schemes.md).

- [x] **COMPLETED** — Stronger selection first: one translucent `--selection`
  color from the palette, shared by the block and canvas editors. WebKit washed
  out the old opaque `--bg-surface2` selection until it was nearly invisible.
- [x] **COMPLETED** — `src/lib/color-schemes.ts`: the eight-color model,
  normalization, a WCAG 2 readability check, and expansion into a full
  `ThemePalette`; the saved library (`createColorSchemes`).
- [x] **COMPLETED** — `src-tauri/src/commands/color_schemes.rs`: schemes in
  `color-schemes.json`, validated again in Rust; the `theme_scheme_id` setting.
- [x] **COMPLETED** — `color schemes list`, `color scheme read`, `create`,
  `update`, and `apply` in the shared catalog. Unreadable schemes return to the
  model as `SCHEME_UNREADABLE` with each measured ratio, before any approval.
- [x] **COMPLETED** — `SchemePreview` on the approval card; the Settings gallery
  (`ColorSchemeGallery`) with **Describe a scheme…**; the background gallery's
  card moved to the shared `GalleryCard`.
- [x] **COMPLETED** — Import removed: `importVSCodeTheme` and the `"imported"`
  mode are gone, stale settings show Dark, and the stored file is deleted.

## Found in the native check

- **The Notes sidebar header and status bar kept the old theme's colors.** Both
  are canvases that read CSS variables, and nothing repainted them when the theme
  changed (switching Dark and Light had the same problem). They now read palette
  fields, as the tab bar does, so a theme change repaints them. `rebuildPalette`
  also writes CSS variables before it sets the palette, so anything that repaints
  on the palette reads the new values (tested).
- The first harness run selected "A line worth…" across Courier's drop cap, which
  splits the first letter into its own node. The harness now selects mid-paragraph.

## Verification

- TypeScript: `bunx tsc --noEmit` passed on October 17.
- Frontend: **687 tests in 70 files passed** on October 17.
- Path utilities: **54 tests passed** on October 17.
- Native workspace: **71 tests passed** on October 17
  (`cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked`).
- Native app: `python3 scripts/prepare-native-macos-smoke.py scheme`, run three
  times in disposable storage. The third run passed all 10 checks with no page
  errors ([report](assets/2026-10-17-scheme-native.json)). Claude Haiku 5.5 made
  "Smoke Paper" (light) and "Smoke Night" (dark); in all three runs both schemes
  passed the readability check on the first try, and approval cards appeared in
  2.7–4.4 seconds. Screenshots: the
  [approval preview](assets/2026-10-17-scheme-approval.png), the
  [gallery](assets/2026-10-17-scheme-gallery.png), and
  [selection under the dark scheme with Courier and a shader background](assets/2026-10-17-scheme-dark-courier-selection.png).
  Selection was clearly visible in every state.
