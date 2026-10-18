# Color schemes — described by the writer, made by the Language Model

Status: **COMPLETED** (2026-10-17). Verified in the native app; see
[the build log](../build-log/2026-10-17-color-schemes.md).

The writer describes a color scheme in words ("warm sepia for late nights", "the
blues of a winter morning") and the Language Model makes it. The writer sees a
preview before approving, and the scheme is saved to a gallery in Settings →
Appearances next to Dark, Light, and Custom. This replaces the VS Code theme
**Import** button, which is removed.

The feature mirrors note backgrounds (`src/lib/background-commands.ts`): the
writer's request goes into a catalog command, the command checks the result
before the writer is asked, the approval card shows a live preview, and the
result lands in an Appearances gallery. Backgrounds check that the shader
compiles; schemes check that they are **readable**.

## What exists today

- **Settings → Appearances → Color Scheme** (`src/ui/SettingsPanel.tsx`) offers
  Dark (`CATPPUCCIN`), Light (`LIGHT_THEME`), Custom (one hue slider →
  `generatePalette(hue)`, always dark), and Import.
- **Import** reads a VS Code theme `.json` through `importVSCodeTheme()`
  (`src/lib/theme.ts`). About half of what it maps is IDE material BusterMark no
  longer draws (syntax tokens, gutter, line numbers). Missing keys fall back to
  Dark, so light VS Code themes come out mixed. The raw file lives in
  `localStorage["buster-imported-theme"]`, outside the settings file. The
  button's handler builds a palette only to validate the file, and fills
  `bgGlow` from `effect_cursor_glow`.
- `rebuildPalette()` (`src/lib/actions-theme.ts`) turns `theme_mode` +
  `theme_hue` into a `ThemePalette`, stores it, and writes CSS variables through
  `applyPaletteToCss()`. Nothing else branches on light versus dark: writing
  styles (`src/lib/blog-themes.ts`), the canvas editor, and shader backgrounds
  all read the palette. **A scheme only has to produce a `ThemePalette`.**
- Selection is now one translucent `--selection` color from the palette, shared
  by both editors. WebKit washes out an opaque `::selection` background, so the
  selection color must stay translucent.
- The Language Model has **no** command that reads or changes the color scheme.

## Decisions

- **Eight colors, not forty.** A scheme stores `background`, `surface`, `text`,
  `textDim`, `textMuted`, `accent`, `accent2`, and `selection`. Everything else
  in `ThemePalette` (surface steps, border, cursor, current line, search
  highlight, crust and mantle, status colors) is derived. The model can't get
  the derived colors wrong, and the gallery swatches show the whole scheme.
- **Light and dark are both allowed.** Whether a scheme is light or dark is
  worked out from the background's luminance, and the derived colors (status
  colors, the unused syntax map) take their base from `LIGHT_THEME` or
  `CATPPUCCIN` to match.
- **Readability is enforced by the command, not suggested.** `check` rejects an
  unreadable scheme with the measured contrast ratios, so the model fixes it
  before the writer is ever asked to approve it.
- **Selection is in the selected scheme, stored in settings.** `theme_mode:
  "scheme"` plus `theme_scheme_id`, so `rebuildPalette()` keeps reading one
  settings object. The schemes themselves live in their own file, as
  backgrounds do.
- **Import is removed outright.** Settings that still say
  `theme_mode: "imported"` fall back to Dark (the existing `else` branch), and
  the stale `localStorage` key is deleted once. There is no migration of an
  imported VS Code theme into a scheme: the writer can ask the model for one.
- **Deleting stays in the interface.** As with backgrounds, the model can
  create, update, list, read, and apply schemes, but only the writer deletes
  them, from the gallery.

## 1 — Scheme model and readability check (pure, testable) — **COMPLETED** (2026-10-17)

- [x] **COMPLETED** — `src/lib/color-schemes.ts`: `SchemeColors` (the eight colors), `ColorScheme`
  (`id`, `name`, `prompt`, `createdAt`, `updatedAt`, `colors`), and
  `parseSchemeColors()`, which accepts `#rgb`, `#rrggbb`, and, for
  `selection` only, `#rrggbbaa` or `rgba()`. Anything else is `INVALID_COLOR`
  with the offending key.
- [x] **COMPLETED** — `paletteFromScheme(colors, fx): ThemePalette`. Surface steps are mixes
  of `surface` toward `text`. `border` sits between `background` and `surface`.
  Cursor uses `accent`. Current line and search highlight are translucent tints
  of `text` and `accent2`. `cssBase`, `cssMantle`, and `cssCrust` step down from
  `background`. Status colors and the syntax map come from `LIGHT_THEME` or
  `CATPPUCCIN` by luminance.
- [x] **COMPLETED** — `checkScheme(colors)` returns every failure at once, each with its
  measured ratio and the required one (WCAG 2 relative luminance):
  - `text` on `background` ≥ 7:1, and `text` on `surface` ≥ 4.5:1;
  - `textDim` on `background` ≥ 4.5:1; `textMuted` on `background` ≥ 2.25:1
    (hints and captions only, never body text);
  - `accent` on `background` ≥ 3:1 (it colors links, the selected-block
    outline, and the Spread target word);
  - `selection` must be translucent (alpha 0.2–0.6). Composited over
    `background`, it must differ from the background by at least 1.25:1, and
    `text` over the composite must stay ≥ 4.5:1.

  Measured on the built-ins (2026-10-17): Dark has text 15.1, on surface 13.4,
  dim 7.8, muted 2.9, accent 9.3, selection 2.25 and text on selection 6.7.
  Light has 9.6, 7.9, 5.8, 2.5, 3.6, 1.43 and 6.7. A 3:1 muted floor would
  reject both built-ins, which is why it sits at 2.25.
- [x] **COMPLETED** — Tests: the built-in Dark and Light pass (or the thresholds are wrong). A
  low-contrast scheme, an opaque selection, and a vanishing selection each fail
  with the right key and numbers. Luminance picks the right base.
  `paletteFromScheme` fills every `ThemePalette` field.

## 2 — Storage — **COMPLETED** (2026-10-17)

- [x] **COMPLETED** — `src-tauri/src/commands/color_schemes.rs`: `color-schemes.json` in the app
  config directory (`{ version, items }`), written through
  `crate::storage::write`. Commands `color_schemes_load`, `color_scheme_save`
  (creates when `id` is absent, ids like `scheme-<millis>`), and
  `color_scheme_delete`. Colors are validated again on the Rust side, so a
  malformed file can't reach the palette. Rust round-trip test, following
  `saves_lists_updates_selects_and_deletes_backgrounds`.
- [x] **COMPLETED** — `AppSettings` gains `theme_scheme_id: String` (serde default empty) in
  `src-tauri/src/commands/settings.rs`, `src/lib/ipc.ts`, and the defaults in
  `src/lib/BusterProvider.tsx`.
- [x] **COMPLETED** — `createColorSchemes(ipc)` in `src/lib/color-schemes.ts`, shaped like
  `createBackgrounds`: a Solid store with `load`, `save`, `rename`, `remove`,
  and `byId`, plus an IPC fake for tests.
- [x] **COMPLETED** — `rebuildPalette()` gains a `"scheme"` branch: the selected scheme goes
  through `paletteFromScheme` and `applyPaletteToCss`. If the scheme is missing
  (deleted, or the file is unreadable), it falls back to Dark without
  overwriting the setting. The palette is rebuilt when the library loads or the
  selected scheme changes (an effect in `BusterProvider.tsx` that tracks the scheme's colors).

## 3 — Catalog commands and the approval preview — **COMPLETED** (2026-10-17)

Registered in `registerColorSchemeCommands(commands, schemes, settings)`, so the
interface and the model share one path.

- [x] **COMPLETED** — `color schemes list` (read): the current mode, the hue when Custom, the
  selected scheme, and each saved scheme's id, name, prompt, and colors.
- [x] **COMPLETED** — `color scheme read` (read): one scheme, for revising it.
- [x] **COMPLETED** — `color scheme create` (write): `name`, `prompt`, `colors`, and an optional
  `apply` (default true). `check` runs `parseSchemeColors` + `checkScheme`, so
  the result `SCHEME_UNREADABLE` lists each failing pair with its ratios. The
  description carries a short contract: what each of the eight colors is used
  for, the contrast thresholds, translucent selection, and "a writing surface,
  calm and readable for hours."
- [x] **COMPLETED** — `color scheme update` (write): `id`, `colors`, and optional `name` /
  `prompt`, with the same check.
- [x] **COMPLETED** — `color scheme apply` (write): a saved `id`, or `"dark"` / `"light"` for
  the built-ins.
- [x] **COMPLETED** — `SchemePreview.tsx`: a small page drawn in the proposed colors, with a
  heading in `accent`, a paragraph in `text` with a phrase highlighted in
  `selection`, a `textDim` line and a `textMuted` caption on a `surface` card,
  and the eight swatches. The `AssistantSidebar.tsx` approval card gets
  `Match` arms for `color scheme create` and `color scheme update`, beside the
  background ones, titled "Create and use the color scheme **Name**?" and
  "Update the color scheme **Name**?".
  Also an arm for `color scheme apply`. Seen in the native app on 2026-10-17.
- [x] **COMPLETED** — Command tests (following `background-commands.test.ts`): create rejects
  unreadable and malformed schemes before approval; create with `apply: false`
  saves without switching; update keeps the name unless one is given; apply
  accepts saved ids and built-ins and rejects unknown ids with `NOT_FOUND`.

## 4 — Settings → Appearances — **COMPLETED** (2026-10-17)

- [x] **COMPLETED** — The Color Scheme row becomes **Dark · Light · Custom**. Custom keeps the
  hue slider and swatches.
- [x] **COMPLETED** — Below it, a gallery of saved schemes, modelled on `BackgroundGallery.tsx`.
  Each card shows the scheme's swatches on its own background, with its name.
  Clicking applies it, and each card can be renamed or deleted (deleting the
  scheme in use falls back to Dark).
- [x] **COMPLETED** — A **Describe a scheme…** button opens the Language Model sidebar with the
  draft "Make me a color scheme: " and focuses it. When nothing is saved yet,
  the gallery shows one line explaining that schemes come from a description.
- [x] **COMPLETED** — `SettingsPanel.test.ts`: there is no Import button, the gallery renders
  saved schemes, and clicking a card sets `theme_mode: "scheme"` and
  `theme_scheme_id`.
- [x] **COMPLETED** — The background gallery's card (pick, rename, delete with confirmation) moved
  into `src/ui/GalleryCard.tsx`, shared by both galleries.

## 5 — Remove Import — **COMPLETED** (2026-10-17)

- [x] **COMPLETED** — Delete the Import button and its `FileReader` handler from
  `SettingsPanel.tsx`.
- [x] **COMPLETED** — Delete `importVSCodeTheme`, `SCOPE_MAP`, `VSCodeTokenColor`, and
  `VSCodeThemeJSON` from `src/lib/theme.ts`, and the `"imported"` branch from
  `actions-theme.ts`. On load, remove `localStorage["buster-imported-theme"]`
  if present (once, when the theme actions are created).
- [x] **COMPLETED** — Settings reading `theme_mode: "imported"` resolve to Dark. Tested in
  `color-schemes.test.ts` (palette) and `SettingsPanel.test.ts` (Dark is marked).
- [x] **COMPLETED** — `docs/documentation.md` no longer claims VS Code themes can be imported.

## 6 — Verification and docs — **COMPLETED** (2026-10-17)

- [x] **COMPLETED** — Unit tests, `bunx tsc --noEmit`, and the Rust workspace tests pass.
- [x] **COMPLETED** — Targeted native check in the real app, because selection painting is a
  WebKit question: create a light and a dark scheme through the Language
  Model, approve each, and screenshot a Markdown note with a selection, the
  Courier style, and a shader background behind it.
- [x] **COMPLETED** — README (Settings paragraph), `docs/internal-commands.md` (the five
  commands), and `docs/macos-parity.md` (the Linux build still has Import
  until this is ported).
- [x] **COMPLETED** — Build log entry in `growth/build-log/`.
- [x] **COMPLETED** — `scripts/native-macos-scheme-smoke.js` (staged with
  `prepare-native-macos-smoke.py scheme`) holds at each stage for an outside
  screenshot. It found the sidebar header and status bar keeping old theme
  colors; both now paint from palette fields.

## Later, not in this plan

- A scheme drawn from an image the writer drops into the chat.
- Pairing a scheme with a background in a single "look" (a scheme's accent
  already feeds `u.accent` in shaders, so they match today).
- Letting the Custom hue slider tune a saved scheme.
