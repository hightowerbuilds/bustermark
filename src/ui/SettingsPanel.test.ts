// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import SettingsPanel from "./SettingsPanel";
import { CATPPUCCIN } from "../lib/theme";
import type { AppSettings } from "../lib/ipc";
import { FeatureCommands } from "../lib/feature-commands";
import { createWritingAppearance, registerWritingAppearanceCommands } from "../lib/writing-appearance";

const sepia = { id: "scheme-1", name: "Sepia", prompt: "warm sepia", createdAt: 1, updatedAt: 1, colors: {
  background: "#f4ecd8", surface: "#e9dfc6", text: "#3a2e1f", textDim: "#5e4d36",
  textMuted: "#8a7a62", accent: "#9a4f1c", accent2: "#5b6e3a", selection: "rgba(154, 79, 28, 0.3)",
} };
const mock = vi.hoisted(() => ({ schemes: [] as unknown[], draft: "", setDraft: vi.fn(), setOpen: vi.fn(), remove: vi.fn(async () => {}), layout: {} as Record<string, unknown> }));
vi.mock("../lib/buster-context", () => ({ useBuster: () => ({ ...mock.layout, store: { palette: CATPPUCCIN, tabs: [] }, backgrounds: {
  state: { loaded: true, error: "", items: [], selected: null, strength: 0.35, animate: true },
  compile: vi.fn(), select: vi.fn(async () => {}), configure: vi.fn(async () => {}), remove: vi.fn(async () => {}),
}, colorSchemes: {
  state: { loaded: true, error: "", get items() { return mock.schemes; } },
  byId: (id: string) => (mock.schemes as { id: string }[]).find(item => item.id === id),
  rename: vi.fn(), remove: mock.remove,
}, assistant: { state: { get draft() { return mock.draft; } }, setDraft: mock.setDraft, setOpen: mock.setOpen } }) }));
function layout() {
  const appearance = createWritingAppearance({ tabIds: () => [], load: () => null, save: () => {} });
  const commands = new FeatureCommands();
  registerWritingAppearanceCommands(commands, appearance);
  return { appearance, commands };
}
mock.layout = layout();
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); mock.schemes = []; mock.draft = ""; vi.clearAllMocks(); });
function mount(overrides: Partial<AppSettings> = {}) {
  const [settings, setSettings] = createStore({ font_size: 14, ui_zoom: 100, theme_mode: "dark", theme_hue: -1, theme_scheme_id: "",
    terminal_scrollback_rows: 10000, language_settings: { rust: { tab_size: 8 } },
    syntax_colors: { keyword: "#abcdef" }, auto_save_delay_ms: 9000, keybindings: {}, ...overrides,
  } as unknown as AppSettings);
  const root = document.createElement("div"); document.body.append(root);
  dispose = render(() => createComponent(SettingsPanel, { get settings() { return settings; }, onChange: next => setSettings(next) }), root);
  return { root, settings };
}
describe("writing settings", () => {
  it("groups useful settings and hides IDE controls and shortcuts", () => {
    const { root } = mount();
    expect([...root.querySelectorAll('[role="tab"]')].map(el => el.textContent?.trim())).toEqual(["Appearances", "Hotkeys"]);
    expect([...root.querySelectorAll("h2")].map(el => el.textContent)).toEqual(["Appearance", "Writing", "Backgrounds"]);
    let text = root.textContent!;
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[role="tab"]')) { tab.click(); text += root.textContent; }
    for (const label of ["Writing Style", "Text Size", "Note layout", "Every note uses the default layout.", "Backgrounds", "New Note", "Save As"]) expect(text).toContain(label);
    for (const label of ["Shell Font", "Shell Program", "Shell History", "New Shell", "Shell Bell", "Minimap", "Line Numbers", "Tab Size", "Insert Spaces", "Format On Save", "Auto Save Delay", "Autocomplete", "Syntax Token Colors", "Language Overrides", "Cursor Glow", "Film Grain", "Vignette", "Blog Mode Theme", "go To Symbol", "next Problem"]) expect(text).not.toContain(label);
  });
  it("switches categories with arrow keys and shows only the selected content", () => {
    const { root } = mount();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector('[role="tabpanel"]')?.textContent).toContain("Keyboard Shortcuts");
    expect(root.querySelector('[role="tabpanel"]')?.textContent).not.toContain("Writing Style");
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    expect(root.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(tabs[0].id);
  });
  it("changes writing preferences without deleting legacy configuration", () => {
    const { root, settings } = mount();
    [...root.querySelectorAll("button")].find(button => button.textContent === "Courier")!.click();
    expect(settings.blog_theme).toBe("courier");
    [...root.querySelectorAll("button")].find(button => button.textContent === "None")!.click();
    expect(settings.blog_theme).toBe("none");
    expect(settings.language_settings).toEqual({ rust: { tab_size: 8 } });
    expect(settings.syntax_colors).toEqual({ keyword: "#abcdef" });
    expect(settings.auto_save_delay_ms).toBe(9000);
  });
});

describe("color schemes", () => {
  const button = (root: HTMLElement, text: string) => [...root.querySelectorAll("button")].find(b => b.textContent === text);
  const pressed = (root: HTMLElement) => [...root.querySelectorAll('[aria-pressed="true"]')].map(b => b.textContent);

  it("offers Dark, Light, and Custom, with no VS Code import", () => {
    const { root } = mount();
    expect([...root.querySelectorAll(".settings-theme-content > .settings-row-inner button")].map(b => b.textContent)).toEqual(["Dark", "Light", "Custom"]);
    expect(button(root, "Import")).toBeUndefined();
    expect(root.textContent).toContain("warm sepia for late nights");
  });

  it("shows saved schemes and switches to one", () => {
    mock.schemes = [sepia];
    const { root, settings } = mount();
    expect(root.querySelector('[role="radiogroup"][aria-label="Saved color schemes"]')?.textContent).toContain("Sepia");
    root.querySelector<HTMLButtonElement>('.scheme-gallery [role="radio"]')!.click();
    expect(settings).toMatchObject({ theme_mode: "scheme", theme_scheme_id: "scheme-1" });
    expect(root.querySelector('.scheme-gallery [role="radio"]')?.getAttribute("aria-checked")).toBe("true");
    expect(pressed(root)).toEqual([]);
    button(root, "Light")!.click();
    expect(settings).toMatchObject({ theme_mode: "light", theme_hue: -1 });
  });

  it("marks Dark for a missing scheme or the retired imported mode", () => {
    expect(pressed(mount({ theme_mode: "scheme", theme_scheme_id: "scheme-gone" }).root)).toEqual(["Dark"]);
    dispose?.(); document.body.replaceChildren();
    expect(pressed(mount({ theme_mode: "imported" }).root)).toEqual(["Dark"]);
  });

  it("falls back to Dark after deleting the scheme on screen", async () => {
    mock.schemes = [sepia];
    const { root, settings } = mount({ theme_mode: "scheme", theme_scheme_id: "scheme-1" });
    root.querySelector<HTMLButtonElement>('[aria-label="Delete Sepia"]')!.click();
    button(root, "Delete")!.click();
    await vi.waitFor(() => expect(settings).toMatchObject({ theme_mode: "dark", theme_scheme_id: "" }));
    expect(mock.remove).toHaveBeenCalledWith("scheme-1");
  });

  it("opens the Language Model with a scheme request, keeping an existing draft", () => {
    const { root } = mount();
    button(root, "Describe a scheme…")!.click();
    expect(mock.setDraft).toHaveBeenCalledWith("Make me a color scheme: ");
    expect(mock.setOpen).toHaveBeenCalledWith(true);
    mock.draft = "Half-written question";
    button(root, "Describe a scheme…")!.click();
    expect(mock.setDraft).toHaveBeenCalledTimes(1);
  });
});
