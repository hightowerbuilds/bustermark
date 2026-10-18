import {
  CONTRAST, SELECTION_ALPHA, SchemeColorError, checkScheme, parseSchemeColors, schemeColorsOf,
  type ColorSchemeService, type SchemeColors,
} from "./color-schemes";
import { CommandFailure, objectResult, type CommandSchema, type FeatureCommands } from "./feature-commands";
import type { AppSettings } from "./ipc";
import type { ThemePalette } from "./theme";

/** The scheme contract, shown to the model in the create and update tool descriptions. */
export const SCHEME_CONTRACT = `A color scheme is eight colors for a writing app the writer reads for hours: calm, with crisp text. Light or dark, as the writer describes.
- background: the page behind notes and the app's base.
- surface: cards, menus, fields, code blocks, and buttons on the background.
- text: body text. At least ${CONTRAST.text}:1 against background and ${CONTRAST.textOnSurface}:1 against surface.
- textDim: labels and secondary text. At least ${CONTRAST.textDim}:1 against background.
- textMuted: hints, placeholders, and captions, never body text. At least ${CONTRAST.textMuted}:1 against background.
- accent: links, the caret, focus outlines, and highlighted words; it also tints shader backgrounds. At least ${CONTRAST.accent}:1 against background.
- accent2: a second accent for search highlights and badges.
- selection: the highlight behind selected text, translucent: rgba(r, g, b, a) with a between ${SELECTION_ALPHA.min} and ${SELECTION_ALPHA.max}. Over the background it must stand out (at least ${CONTRAST.selectionVisible}:1) while text on it stays at least ${CONTRAST.textOnSelection}:1.
Every other color is opaque "#rrggbb". Contrast is WCAG 2; a scheme that misses a ratio is returned with the measured values to fix.`;

export interface SchemeSettings {
  settings(): AppSettings;
  update(settings: AppSettings): void;
  palette(): ThemePalette;
}

const BUILT_IN = ["dark", "light"] as const;

const str: CommandSchema = { type: "string" };
const id: CommandSchema = { type: "string", minLength: 1 };
const obj = (properties: Record<string, CommandSchema>, required = Object.keys(properties)): CommandSchema =>
  ({ type: "object", properties, required, additionalProperties: false });
const colorsSchema = obj({ background: str, surface: str, text: str, textDim: str, textMuted: str, accent: str, accent2: str, selection: str });

export function registerColorSchemeCommands(commands: FeatureCommands, schemes: ColorSchemeService, settings: SchemeSettings) {
  const add = (name: string, description: string, inputSchema: CommandSchema, effect: "read" | "write",
    run: (args: any) => unknown, check?: (args: any) => Promise<void> | void, example?: string) =>
    commands.register({ name, description, version: 1, effect, inputSchema, outputSchema: objectResult,
      examples: [example ?? name], check, run });

  const loaded = async () => { if (!schemes.state.loaded) await schemes.load(); };
  const existing = (schemeId: string) => {
    const item = schemes.byId(schemeId);
    if (!item) throw new CommandFailure("NOT_FOUND", "No saved color scheme has that ID. Use color schemes list.");
    return item;
  };
  const name = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 80) throw new CommandFailure("INVALID_ARGUMENTS", "Give the color scheme a name of up to 80 characters.");
    return trimmed;
  };
  /** Well-formed and readable, or a failure the model can act on. */
  const readable = (colors: unknown): SchemeColors => {
    let parsed: SchemeColors;
    try { parsed = parseSchemeColors(colors); }
    catch (e) {
      if (e instanceof SchemeColorError) throw new CommandFailure("INVALID_COLOR", `Fix these colors and try again:\n${e.message}`);
      throw e;
    }
    const failures = checkScheme(parsed);
    if (failures.length) {
      throw new CommandFailure("SCHEME_UNREADABLE", `The scheme is hard to read. Adjust these colors and try again:\n${failures.map(f => `- ${f.message}`).join("\n")}`);
    }
    return parsed;
  };
  const show = (schemeId: string) => {
    const current = settings.settings();
    if (schemeId === "dark" || schemeId === "light") settings.update({ ...current, theme_mode: schemeId, theme_hue: -1 });
    else settings.update({ ...current, theme_mode: "scheme", theme_scheme_id: schemeId });
  };
  const current = () => {
    try { return schemeColorsOf(settings.palette()); } catch { return undefined; }
  };

  add("color schemes list", "List the writer's saved color schemes, which one is shown, and the eight colors currently on screen (to adjust them).",
    obj({}), "read", async () => {
      await loaded();
      const s = settings.settings();
      const mode = s.theme_mode === "scheme" && schemes.byId(s.theme_scheme_id) ? "scheme"
        : s.theme_mode === "light" || (s.theme_mode === "custom" && s.theme_hue >= 0) ? s.theme_mode : "dark";
      return {
        shown: mode === "scheme" ? s.theme_scheme_id : mode,
        ...(mode === "custom" ? { hue: s.theme_hue } : {}),
        current: current(),
        builtIn: BUILT_IN,
        schemes: schemes.state.items.map(item => ({ id: item.id, name: item.name, prompt: item.prompt, colors: { ...item.colors } })),
      };
    });

  add("color scheme read", "Read a saved color scheme's name, prompt, and colors, for example to revise it.",
    obj({ id }), "read", async args => {
      await loaded();
      const item = existing(args.id);
      return { id: item.id, name: item.name, prompt: item.prompt, colors: { ...item.colors } };
    }, undefined, 'color scheme read {"id":"scheme-1790000000000"}');

  add("color scheme create", `Create a color scheme from the writer's description and save it to their Appearances gallery. The writer sees a preview before approving. By default it is also shown; pass "apply": false to only save it. Put the writer's request in "prompt".\n${SCHEME_CONTRACT}`,
    obj({ name: str, prompt: str, colors: colorsSchema, apply: { type: "boolean" } }, ["name", "prompt", "colors"]), "write", async args => {
      const item = await schemes.save({ name: name(args.name), prompt: String(args.prompt), colors: readable(args.colors) });
      if (args.apply !== false) show(item.id);
      return { id: item.id, name: item.name, applied: args.apply !== false };
    }, args => { name(args.name); readable(args.colors); });

  add("color scheme update", `Replace a saved color scheme's colors (and optionally its name or prompt). The writer sees a preview before approving.\n${SCHEME_CONTRACT}`,
    obj({ id, colors: colorsSchema, name: str, prompt: str }, ["id", "colors"]), "write", async args => {
      await loaded();
      const item = existing(args.id);
      const saved = await schemes.save({ id: item.id, name: args.name !== undefined ? name(args.name) : item.name,
        prompt: args.prompt ?? item.prompt, colors: readable(args.colors) });
      return { id: saved.id, name: saved.name };
    }, async args => { await loaded(); existing(args.id); if (args.name !== undefined) name(args.name); readable(args.colors); });

  add("color scheme apply", `Show a saved color scheme, or the built-in "dark" or "light".`, obj({ id }), "write", async args => {
    await loaded();
    if (!(BUILT_IN as readonly string[]).includes(args.id)) existing(args.id);
    show(args.id);
    return { shown: args.id };
  }, async args => { await loaded(); if (!(BUILT_IN as readonly string[]).includes(args.id)) existing(args.id); },
  'color scheme apply {"id":"light"}');
}
