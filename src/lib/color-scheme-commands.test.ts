import { describe, expect, it } from "vitest";
import { isAssistantTool } from "./assistant-tools";
import { registerColorSchemeCommands, SCHEME_CONTRACT } from "./color-scheme-commands";
import { createColorSchemes, type ColorSchemeIpc, type ColorSchemeLibrary } from "./color-schemes";
import { FeatureCommands } from "./feature-commands";
import type { AppSettings } from "./ipc";
import { CATPPUCCIN } from "./theme";

const sepia = {
  background: "#f4ecd8", surface: "#e9dfc6", text: "#3a2e1f", textDim: "#5e4d36",
  textMuted: "#8a7a62", accent: "#9a4f1c", accent2: "#5b6e3a", selection: "rgba(154, 79, 28, 0.3)",
};

async function fixture() {
  let library: ColorSchemeLibrary = { version: 1, items: [] };
  let next = 0;
  const ipc: ColorSchemeIpc = {
    load: async () => structuredClone(library),
    save: async request => {
      const item = { id: request.id ?? `scheme-${++next}`, name: request.name, prompt: request.prompt, createdAt: 1, updatedAt: 2, colors: request.colors };
      library = { ...library, items: [...library.items.filter(i => i.id !== item.id), item] };
      return structuredClone(item);
    },
    remove: async () => {},
  };
  const schemes = createColorSchemes(ipc);
  let settings = { theme_mode: "dark", theme_hue: -1, theme_scheme_id: "" } as AppSettings;
  const commands = new FeatureCommands();
  registerColorSchemeCommands(commands, schemes, { settings: () => settings, update: s => { settings = s; }, palette: () => CATPPUCCIN });
  const run = (command: string, args: Record<string, unknown> = {}) => commands.dispatch({ command, args, requestId: crypto.randomUUID() }, "ai");
  return { commands, schemes, run, settings: () => settings, library: () => library };
}

describe("color scheme commands", () => {
  it("creates and shows a scheme, or only saves it", async () => {
    const f = await fixture();
    const created = await f.run("color scheme create", { name: " Sepia ", prompt: "warm sepia for late nights", colors: { ...sepia, background: "#F4ECD8" } });
    expect(created).toMatchObject({ ok: true, data: { id: "scheme-1", name: "Sepia", applied: true } });
    expect(f.settings()).toMatchObject({ theme_mode: "scheme", theme_scheme_id: "scheme-1" });
    expect(f.library().items[0].colors.background).toBe("#f4ecd8");

    const saved = await f.run("color scheme create", { name: "Moss", prompt: "moss", colors: sepia, apply: false });
    expect(saved).toMatchObject({ ok: true, data: { id: "scheme-2", applied: false } });
    expect(f.settings().theme_scheme_id).toBe("scheme-1");

    const listed = await f.run("color schemes list");
    expect(listed).toMatchObject({ ok: true, data: {
      shown: "scheme-1", builtIn: ["dark", "light"],
      schemes: [{ id: "scheme-1", name: "Sepia", prompt: "warm sepia for late nights", colors: { background: "#f4ecd8" } }, { id: "scheme-2", name: "Moss" }],
    } });
  });

  it("returns unreadable and malformed schemes to the model before approval", async () => {
    const f = await fixture();
    const unreadable = await f.commands.check("color scheme create", { name: "Fog", prompt: "", colors: { ...sepia, text: "#b0a48c" } });
    expect(unreadable).toMatchObject({ ok: false, error: { code: "SCHEME_UNREADABLE" } });
    expect(!unreadable.ok && unreadable.error.message).toMatch(/- text on background is [\d.]+:1; needs at least 7:1\./);

    const opaque = await f.commands.check("color scheme create", { name: "Fog", prompt: "", colors: { ...sepia, selection: "#9a4f1c" } });
    expect(opaque).toMatchObject({ ok: false, error: { code: "INVALID_COLOR" } });
    expect(!opaque.ok && opaque.error.message).toContain("selection:");

    expect(await f.commands.check("color scheme create", { name: "", prompt: "", colors: sepia })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.commands.check("color scheme create", { name: "Sepia", prompt: "", colors: { ...sepia, glow: "#fff" } })).toMatchObject({ ok: false });
    expect(await f.commands.check("color scheme create", { name: "Sepia", prompt: "", colors: sepia })).toEqual({ ok: true });
    expect(f.library().items).toEqual([]);
  });

  it("reads, updates, and applies saved and built-in schemes", async () => {
    const f = await fixture();
    await f.run("color scheme create", { name: "Sepia", prompt: "p", colors: sepia, apply: false });
    expect(await f.run("color scheme read", { id: "scheme-1" })).toMatchObject({ ok: true, data: { name: "Sepia", colors: sepia } });

    const night = { ...sepia, background: "#1d1812", surface: "#2a231a", text: "#efe3cc", textDim: "#c9b99b", textMuted: "#8f8069", accent: "#e0a060", selection: "rgba(224, 160, 96, 0.3)" };
    expect(await f.run("color scheme update", { id: "scheme-1", colors: night, name: "Sepia night" })).toMatchObject({ ok: true, data: { name: "Sepia night" } });
    expect(f.schemes.byId("scheme-1")).toMatchObject({ prompt: "p", colors: { background: "#1d1812" } });
    expect(await f.run("color scheme update", { id: "missing", colors: night })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.commands.check("color scheme update", { id: "scheme-1", colors: { ...night, text: "#3a2e1f" } })).toMatchObject({ ok: false, error: { code: "SCHEME_UNREADABLE" } });

    expect(await f.run("color scheme apply", { id: "scheme-1" })).toMatchObject({ ok: true, data: { shown: "scheme-1" } });
    expect(f.settings()).toMatchObject({ theme_mode: "scheme", theme_scheme_id: "scheme-1" });
    expect(await f.run("color scheme apply", { id: "light" })).toMatchObject({ ok: true });
    expect(f.settings()).toMatchObject({ theme_mode: "light", theme_hue: -1 });
    expect(await f.commands.check("color scheme apply", { id: "scheme-404" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("reports what is on screen, including a missing scheme as Dark", async () => {
    const f = await fixture();
    const listed = await f.run("color schemes list");
    expect(listed).toMatchObject({ ok: true, data: { shown: "dark", current: { background: CATPPUCCIN.editorBg, selection: CATPPUCCIN.selection } } });
    f.settings().theme_mode = "scheme";
    f.settings().theme_scheme_id = "scheme-gone";
    expect(await f.run("color schemes list")).toMatchObject({ ok: true, data: { shown: "dark" } });
  });

  it("asks for approval on every change and exposes the tools to the model", async () => {
    const f = await fixture();
    const described = f.commands.describe();
    for (const name of ["color scheme create", "color scheme update", "color scheme apply"]) {
      expect(described.find(c => c.name === name)?.confirm, name).toBe(true);
    }
    expect(described.find(c => c.name === "color schemes list")?.confirm).toBe(false);
    for (const name of described.map(c => c.name)) expect(isAssistantTool(name), name).toBe(true);
    expect(described.find(c => c.name === "color scheme create")?.description).toContain(SCHEME_CONTRACT);
  });
});
