import { afterEach, describe, expect, it, vi } from "vitest";
import { createThemeActions } from "./actions-theme";
import {
  CONTRAST, SchemeColorError, checkScheme, createColorSchemes, isLightBackground, paletteFromScheme, parseSchemeColors,
  schemeColorsOf, type ColorSchemeIpc, type ColorSchemeLibrary, type SchemeColors,
} from "./color-schemes";
import type { AppSettings } from "./ipc";
import { CATPPUCCIN, LIGHT_THEME, type ThemePalette } from "./theme";

const fx = { bgGlow: 0, cursorGlow: 10, vignette: 20, grain: 30 };

const sepia: SchemeColors = {
  background: "#f4ecd8", surface: "#e9dfc6", text: "#3a2e1f", textDim: "#5e4d36",
  textMuted: "#8a7a62", accent: "#9a4f1c", accent2: "#5b6e3a", selection: "rgba(154, 79, 28, 0.3)",
};

function problemKeys(run: () => unknown): string[] {
  try { run(); } catch (error) {
    if (error instanceof SchemeColorError) return error.problems.map(p => p.key);
    throw error;
  }
  return [];
}

describe("parseSchemeColors", () => {
  it("normalizes hex to lowercase #rrggbb and selection to rgba()", () => {
    const colors = parseSchemeColors({ ...sepia, background: " #FFF ", accent: "#9A4F1C", selection: "#9a4f1c4d" });
    expect(colors.background).toBe("#ffffff");
    expect(colors.accent).toBe("#9a4f1c");
    expect(colors.selection).toBe("rgba(154, 79, 28, 0.302)");
  });

  it("reports every missing, malformed, and unknown key at once", () => {
    const { textDim: _, ...missing } = sepia;
    expect(problemKeys(() => parseSchemeColors({ ...missing, text: "black", accent: "#9a4f1c80", selection: "#9a4f1c", glow: "#fff" })))
      .toEqual(["text", "textDim", "accent", "selection", "glow"]);
  });

  it("rejects out-of-range rgba channels and non-objects", () => {
    expect(problemKeys(() => parseSchemeColors({ ...sepia, selection: "rgba(300, 0, 0, 0.3)" }))).toEqual(["selection"]);
    expect(problemKeys(() => parseSchemeColors(["#fff"]))).toEqual(["colors"]);
    expect(problemKeys(() => parseSchemeColors(null))).toEqual(["colors"]);
  });
});

describe("checkScheme", () => {
  it("passes the built-in Dark and Light themes", () => {
    expect(checkScheme(schemeColorsOf(CATPPUCCIN))).toEqual([]);
    expect(checkScheme(schemeColorsOf(LIGHT_THEME))).toEqual([]);
    expect(checkScheme(parseSchemeColors(sepia))).toEqual([]);
  });

  it("reports low-contrast text with its measured and required ratios", () => {
    const failures = checkScheme(parseSchemeColors({ ...sepia, text: "#9a8a70" }));
    const text = failures.find(f => f.check === "text on background")!;
    expect(text.required).toBe(CONTRAST.text);
    expect(text.ratio).toBeLessThan(CONTRAST.text);
    expect(text.message).toMatch(/^text on background is [\d.]+:1; needs at least 7:1\.$/);
    expect(failures.map(f => f.check)).toContain("text on surface");
  });

  it("rejects an opaque or nearly invisible selection", () => {
    const opaque = checkScheme(parseSchemeColors({ ...sepia, selection: "rgba(154, 79, 28, 1)" }));
    expect(opaque.map(f => f.check)).toContain("selection alpha");
    const faint = checkScheme(parseSchemeColors({ ...sepia, selection: "rgba(240, 232, 212, 0.3)" }));
    expect(faint.map(f => f.check)).toEqual(["selection against background"]);
  });

  it("rejects a selection that makes the text unreadable", () => {
    const heavy = checkScheme(parseSchemeColors({ ...sepia, selection: "rgba(40, 30, 20, 0.6)" }));
    expect(heavy.map(f => f.check)).toContain("text on selection");
  });
});

describe("paletteFromScheme", () => {
  it("tells light backgrounds from dark ones", () => {
    expect(isLightBackground("#f4ecd8")).toBe(true);
    expect(isLightBackground("#e8e0d4")).toBe(true);
    expect(isLightBackground("#0c0c0c")).toBe(false);
    expect(isLightBackground("#1e2a44")).toBe(false);
  });

  it("fills every palette field and keeps the scheme's own colors", () => {
    const palette = paletteFromScheme(parseSchemeColors(sepia), fx);
    expect(Object.keys(palette).sort()).toEqual(Object.keys(LIGHT_THEME).sort());
    expect(palette).toMatchObject({
      editorBg: "#f4ecd8", surface0: "#e9dfc6", text: "#3a2e1f", accent: "#9a4f1c", accent2: "#5b6e3a",
      selection: "rgba(154, 79, 28, 0.3)", cursor: "#9a4f1c", cssBase: "#f4ecd8", accentRgb: [154, 79, 28], ...fx,
    });
    for (const value of Object.values(palette)) expect(value).not.toBeUndefined();
  });

  it("takes status colors from the matching built-in and steps surfaces toward the text", () => {
    const light = paletteFromScheme(parseSchemeColors(sepia), fx);
    expect(light.error).toBe(LIGHT_THEME.error);
    expect(light.syntax).toEqual(LIGHT_THEME.syntax);
    expect(light.cssMantle < light.cssBase).toBe(true);

    const dark = paletteFromScheme(schemeColorsOf(CATPPUCCIN), fx);
    expect(dark.error).toBe(CATPPUCCIN.error);
    expect(dark.surface1).toBe("#2a2a2a");
    expect(dark.surface2).toBe("#3a3a3a");
    expect(dark.cssCrust).toBe("#050505");
  });
});

function fakeIpc(initial: Partial<ColorSchemeLibrary> = {}) {
  let library: ColorSchemeLibrary = { version: 1, items: [], ...initial };
  const ipc: ColorSchemeIpc = {
    load: vi.fn(async () => structuredClone(library)),
    save: vi.fn(async request => {
      const previous = library.items.find(i => i.id === request.id);
      const item = { id: request.id ?? `scheme-${library.items.length + 1}`, name: request.name, prompt: request.prompt,
        createdAt: previous?.createdAt ?? 1, updatedAt: 2, colors: request.colors };
      library = { ...library, items: [...library.items.filter(i => i.id !== item.id), item] };
      return structuredClone(item);
    }),
    remove: vi.fn(async id => {
      if (!library.items.some(i => i.id === id)) throw new Error("No saved color scheme has that ID.");
      library = { ...library, items: library.items.filter(i => i.id !== id) };
    }),
  };
  return ipc;
}

describe("createColorSchemes", () => {
  it("saves normalized colors, renames, and removes", async () => {
    const ipc = fakeIpc();
    const schemes = createColorSchemes(ipc);
    await schemes.load();
    const item = await schemes.save({ name: "Sepia", prompt: "warm sepia", colors: { ...sepia, background: "#F4ECD8", selection: "#9a4f1c4d" } });
    expect(ipc.save).toHaveBeenCalledWith(expect.objectContaining({ colors: expect.objectContaining({ background: "#f4ecd8", selection: "rgba(154, 79, 28, 0.302)" }) }));
    expect(schemes.byId(item.id)?.name).toBe("Sepia");

    await schemes.rename(item.id, "  Sepia night  ");
    expect(schemes.byId(item.id)).toMatchObject({ name: "Sepia night", prompt: "warm sepia", colors: { background: "#f4ecd8" } });
    await expect(schemes.rename(item.id, "  ")).rejects.toThrow("name");
    await expect(schemes.rename("missing", "X")).rejects.toThrow("no longer exists");

    await schemes.remove(item.id);
    expect(schemes.state.items).toEqual([]);
    expect(schemes.byId(item.id)).toBeUndefined();
  });

  it("refuses malformed colors before they reach storage", async () => {
    const ipc = fakeIpc();
    const schemes = createColorSchemes(ipc);
    await expect(schemes.save({ name: "Bad", prompt: "", colors: { ...sepia, text: "black" } })).rejects.toBeInstanceOf(SchemeColorError);
    expect(ipc.save).not.toHaveBeenCalled();
  });

  it("records a load failure instead of throwing", async () => {
    const schemes = createColorSchemes({ ...fakeIpc(), load: async () => { throw new Error("read failed"); } });
    await schemes.load();
    expect(schemes.state).toMatchObject({ loaded: true, error: "read failed", items: [] });
  });
});

describe("rebuildPalette with a color scheme", () => {
  const css = new Map<string, string>();
  vi.stubGlobal("document", { documentElement: { style: {
    setProperty: (key: string, value: string) => css.set(key, value),
    removeProperty: (key: string) => css.delete(key),
  } } });
  afterEach(() => css.clear());

  function rebuild(settings: Partial<AppSettings>, lookup = (id: string) => (id === "scheme-1" ? parseSchemeColors(sepia) : undefined)) {
    let palette: ThemePalette | undefined;
    const setStore = ((key: string, value: ThemePalette) => { if (key === "palette") palette = value; }) as any;
    createThemeActions(setStore, lookup).rebuildPalette({ theme_mode: "scheme", theme_hue: -1, theme_scheme_id: "scheme-1",
      effect_cursor_glow: 0, effect_vignette: 0, effect_grain: 0, syntax_colors: {}, ...settings } as AppSettings);
    return palette!;
  }

  it("writes CSS variables before the palette changes, so canvas chrome repaints in the new colors", () => {
    let seen = "";
    const setStore = ((key: string) => { if (key === "palette") seen = css.get("--bg-base") ?? ""; }) as any;
    createThemeActions(setStore, () => parseSchemeColors(sepia)).rebuildPalette({ theme_mode: "scheme", theme_scheme_id: "scheme-1",
      theme_hue: -1, effect_cursor_glow: 0, effect_vignette: 0, effect_grain: 0, syntax_colors: {} } as unknown as AppSettings);
    expect(seen).toBe("#f4ecd8");
  });

  it("shows the selected scheme and writes its CSS variables", () => {
    const palette = rebuild({});
    expect(palette.editorBg).toBe("#f4ecd8");
    expect(css.get("--bg-base")).toBe("#f4ecd8");
    expect(css.get("--selection")).toBe("rgba(154, 79, 28, 0.3)");
  });

  it("falls back to Dark when the scheme is missing or the library has not loaded", () => {
    css.set("--bg-base", "#f4ecd8");
    expect(rebuild({ theme_scheme_id: "scheme-gone" }).editorBg).toBe(CATPPUCCIN.editorBg);
    expect(css.has("--bg-base")).toBe(false);
    expect(rebuild({}, () => undefined).editorBg).toBe(CATPPUCCIN.editorBg);
  });

  it("ignores the scheme id in other modes", () => {
    expect(rebuild({ theme_mode: "light" }).editorBg).toBe(LIGHT_THEME.editorBg);
  });

  it("shows Dark for the retired imported mode and drops the stored VS Code theme", () => {
    const stored = new Map([["buster-imported-theme", "{}"], ["buster-recent-files", "[]"]]);
    vi.stubGlobal("localStorage", { removeItem: (key: string) => stored.delete(key) });
    css.set("--bg-base", "#123456");
    expect(rebuild({ theme_mode: "imported" }).editorBg).toBe(CATPPUCCIN.editorBg);
    expect(css.has("--bg-base")).toBe(false);
    expect([...stored.keys()]).toEqual(["buster-recent-files"]);
    vi.unstubAllGlobals();
  });
});
