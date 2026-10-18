import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { AppSettings } from "./ipc";
import type { ThemePalette } from "./theme";
import { paletteFromScheme, type SchemeColors } from "./color-schemes";
import {
  CATPPUCCIN, LIGHT_THEME, generatePalette,
  applyPaletteToCss, clearCssOverrides, withSyntaxOverrides,
} from "./theme";

export function createThemeActions(
  setStore: SetStoreFunction<BusterStoreState>,
  schemeColors: (id: string) => SchemeColors | undefined = () => undefined,
) {
  // VS Code theme import was removed (growth/phases/color-schemes.md); drop the file it stored.
  // A stale theme_mode "imported" falls through to Dark below.
  try { localStorage.removeItem("buster-imported-theme"); } catch { /* no storage */ }

  function rebuildPalette(s: AppSettings) {
    const fx = {
      bgGlow: 0,
      cursorGlow: s.effect_cursor_glow ?? 0,
      vignette: s.effect_vignette ?? 0,
      grain: s.effect_grain ?? 0,
    };
    const mode = s.theme_mode || "dark";
    // A missing scheme (deleted, or the library not loaded yet) shows Dark without changing the setting.
    const scheme = mode === "scheme" ? schemeColors(s.theme_scheme_id) : undefined;
    const custom = mode === "custom" && s.theme_hue >= 0;
    const p: ThemePalette = withSyntaxOverrides(
      scheme ? paletteFromScheme(scheme, fx)
        : custom ? generatePalette(s.theme_hue, fx)
        : mode === "light" ? { ...LIGHT_THEME, ...fx }
        : { ...CATPPUCCIN, ...fx },
      s.syntax_colors,
    );
    // CSS variables first: canvas chrome repaints on the palette change and reads them.
    if (scheme || custom || mode === "light") applyPaletteToCss(p);
    else clearCssOverrides();
    setStore("palette", p);
  }

  return { rebuildPalette };
}
