// Color schemes: eight colors made from the writer's description, checked for
// readability, and expanded into a full ThemePalette (growth/phases/color-schemes.md).

import { invoke } from "@tauri-apps/api/core";
import { createStore, reconcile } from "solid-js/store";
import { CATPPUCCIN, LIGHT_THEME, type ThemeEffects, type ThemePalette } from "./theme";

export const SCHEME_COLOR_KEYS = ["background", "surface", "text", "textDim", "textMuted", "accent", "accent2", "selection"] as const;
export type SchemeColorKey = typeof SCHEME_COLOR_KEYS[number];
export type SchemeColors = Record<SchemeColorKey, string>;

export interface ColorScheme { id: string; name: string; prompt: string; createdAt: number; updatedAt: number; colors: SchemeColors }
export interface ColorSchemeLibrary { version: number; items: ColorScheme[] }
export interface SaveColorScheme { id?: string; name: string; prompt: string; colors: SchemeColors }

/** Every malformed color at once, so the model can fix them in one pass. */
export class SchemeColorError extends Error {
  constructor(readonly problems: { key: string; message: string }[]) {
    super(problems.map(p => `${p.key}: ${p.message}`).join("\n"));
  }
}

export interface SchemeFailure { check: string; message: string; ratio?: number; required?: number }

type Rgb = [number, number, number];

/** WebKit washes out an opaque ::selection background, so selection stays translucent. */
export const SELECTION_ALPHA = { min: 0.2, max: 0.6 };
export const CONTRAST = { text: 7, textOnSurface: 4.5, textDim: 4.5, textMuted: 2.25, accent: 3, selectionVisible: 1.25, textOnSelection: 4.5 };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HEX_ALPHA = /^#([0-9a-f]{6})([0-9a-f]{2})$/i;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;

function hexRgb(hex: string): Rgb {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map(c => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const toRgba = ([r, g, b]: Rgb, a: number) => `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;

function parseSelection(value: string): { rgb: Rgb; alpha: number } | null {
  const hex = value.match(HEX_ALPHA);
  if (hex) return { rgb: hexRgb(`#${hex[1]}`), alpha: parseInt(hex[2], 16) / 255 };
  const rgba = value.match(RGBA);
  if (!rgba) return null;
  const rgb = [rgba[1], rgba[2], rgba[3]].map(Number) as Rgb;
  return rgb.every(v => v <= 255) ? { rgb, alpha: Number(rgba[4]) } : null;
}

/**
 * Validate the eight colors and normalize them: lowercase `#rrggbb`, and
 * `rgba(r, g, b, a)` for the translucent selection. Throws SchemeColorError.
 */
export function parseSchemeColors(input: unknown): SchemeColors {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SchemeColorError([{ key: "colors", message: `expected an object with ${SCHEME_COLOR_KEYS.join(", ")}` }]);
  }
  const record = input as Record<string, unknown>;
  const problems: { key: string; message: string }[] = [];
  const colors = {} as SchemeColors;
  for (const key of SCHEME_COLOR_KEYS) {
    const value = typeof record[key] === "string" ? (record[key] as string).trim() : record[key];
    if (typeof value !== "string") { problems.push({ key, message: "missing" }); continue; }
    if (key === "selection") {
      const selection = parseSelection(value);
      if (selection) colors.selection = toRgba(selection.rgb, selection.alpha);
      else problems.push({ key, message: `"${value}" is not #rrggbbaa or rgba(r, g, b, a)` });
    } else if (HEX.test(value)) colors[key] = toHex(hexRgb(value));
    else problems.push({ key, message: `"${value}" is not an opaque #rgb or #rrggbb color` });
  }
  for (const key of Object.keys(record)) {
    if (!(SCHEME_COLOR_KEYS as readonly string[]).includes(key)) problems.push({ key, message: "not a scheme color" });
  }
  if (problems.length) throw new SchemeColorError(problems);
  return colors;
}

// WCAG 2 relative luminance and contrast ratio.
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Light when dark text would contrast more with the background than white text. */
export function isLightBackground(background: string): boolean {
  const bg = hexRgb(background);
  return contrastRatio(bg, [0, 0, 0]) > contrastRatio(bg, [255, 255, 255]);
}

/** Every readability failure of normalized colors, each with its measured and required ratio. */
export function checkScheme(colors: SchemeColors): SchemeFailure[] {
  const failures: SchemeFailure[] = [];
  const rgb = (key: Exclude<SchemeColorKey, "selection">) => hexRgb(colors[key]);
  const pair = (check: string, a: Rgb, b: Rgb, required: number) => {
    const ratio = Math.round(contrastRatio(a, b) * 100) / 100;
    if (ratio < required) failures.push({ check, ratio, required, message: `${check} is ${ratio}:1; needs at least ${required}:1.` });
  };
  const bg = rgb("background");
  pair("text on background", rgb("text"), bg, CONTRAST.text);
  pair("text on surface", rgb("text"), rgb("surface"), CONTRAST.textOnSurface);
  pair("textDim on background", rgb("textDim"), bg, CONTRAST.textDim);
  pair("textMuted on background", rgb("textMuted"), bg, CONTRAST.textMuted);
  pair("accent on background", rgb("accent"), bg, CONTRAST.accent);

  const selection = parseSelection(colors.selection)!;
  if (selection.alpha < SELECTION_ALPHA.min || selection.alpha > SELECTION_ALPHA.max) {
    failures.push({ check: "selection alpha",
      message: `selection alpha is ${Math.round(selection.alpha * 1000) / 1000}; it must be between ${SELECTION_ALPHA.min} and ${SELECTION_ALPHA.max}.` });
  }
  const selected = mix(bg, selection.rgb, selection.alpha);
  pair("selection against background", selected, bg, CONTRAST.selectionVisible);
  pair("text on selection", rgb("text"), selected, CONTRAST.textOnSelection);
  return failures;
}

/** The eight scheme colors of an existing palette, such as the built-in Dark and Light. */
export function schemeColorsOf(p: ThemePalette): SchemeColors {
  return parseSchemeColors({ background: p.editorBg, surface: p.surface0, text: p.text, textDim: p.textDim,
    textMuted: p.textMuted, accent: p.accent, accent2: p.accent2, selection: p.selection });
}

/** Expand normalized scheme colors into every ThemePalette field. */
export function paletteFromScheme(colors: SchemeColors, fx: ThemeEffects): ThemePalette {
  const light = isLightBackground(colors.background);
  const base = light ? LIGHT_THEME : CATPPUCCIN;
  const black: Rgb = [0, 0, 0];
  const bg = hexRgb(colors.background);
  const surface = hexRgb(colors.surface);
  const text = hexRgb(colors.text);
  const accent = hexRgb(colors.accent);
  const mantle = toHex(mix(bg, black, light ? 0.04 : 0.25));
  return {
    editorBg: colors.background,
    gutterBg: mantle,
    surface0: colors.surface,
    surface1: toHex(mix(surface, text, 0.08)),
    surface2: toHex(mix(surface, text, 0.16)),

    text: colors.text,
    textDim: colors.textDim,
    textMuted: colors.textMuted,

    accent: colors.accent,
    accent2: colors.accent2,
    cursor: colors.accent,
    cursorAlt: colors.accent2,

    border: toHex(mix(bg, surface, 0.75)),
    selection: colors.selection,
    searchHighlight: toRgba(hexRgb(colors.accent2), 0.25),
    currentLine: toRgba(text, light ? 0.05 : 0.035),

    error: base.error,
    warning: base.warning,
    info: colors.accent,

    syntax: { ...base.syntax },
    syntaxDefault: colors.text,

    ...fx,
    accentRgb: accent,

    cssBase: colors.background,
    cssMantle: mantle,
    cssCrust: toHex(mix(bg, black, light ? 0.08 : 0.55)),
  };
}

// ── The saved library ────────────────────────────────────────────

export interface ColorSchemeIpc {
  load(): Promise<ColorSchemeLibrary>;
  save(request: SaveColorScheme): Promise<ColorScheme>;
  remove(id: string): Promise<void>;
}

export const nativeColorSchemeIpc: ColorSchemeIpc = {
  load: () => invoke<ColorSchemeLibrary>("color_schemes_load"),
  save: request => invoke<ColorScheme>("color_scheme_save", { request }),
  remove: id => invoke("color_scheme_delete", { id }),
};

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Saved color schemes. Which one is shown is the `theme_scheme_id` setting. */
export function createColorSchemes(ipc: ColorSchemeIpc) {
  const [state, setState] = createStore({ loaded: false, error: "", items: [] as ColorScheme[] });

  const apply = (library: ColorSchemeLibrary) => {
    setState({ loaded: true, error: "" });
    setState("items", reconcile(library.items, { key: "id" }));
  };

  async function load() {
    try { apply(await ipc.load()); }
    catch (error) { setState({ loaded: true, error: message(error) }); }
  }

  const byId = (id: string | null | undefined) => (id ? state.items.find(item => item.id === id) : undefined);

  async function save(request: SaveColorScheme) {
    const item = await ipc.save({ ...request, colors: parseSchemeColors(request.colors) });
    apply(await ipc.load());
    return item;
  }

  async function remove(id: string) {
    await ipc.remove(id);
    apply(await ipc.load());
  }

  async function rename(id: string, name: string) {
    const item = byId(id);
    if (!item) throw new Error("This color scheme no longer exists.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Enter a color scheme name.");
    return save({ id, name: trimmed, prompt: item.prompt, colors: { ...item.colors } });
  }

  return { state, load, byId, save, remove, rename };
}

export type ColorSchemeService = ReturnType<typeof createColorSchemes>;
