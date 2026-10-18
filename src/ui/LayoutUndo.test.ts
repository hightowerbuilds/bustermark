// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { FeatureCommands } from "../lib/feature-commands";
import { createWritingAppearance, registerWritingAppearanceCommands } from "../lib/writing-appearance";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../lib/buster-context", () => ({ useBuster: () => ctx.value }));
const { default: LayoutUndo } = await import("./LayoutUndo");
const { default: NoteLayoutSettings } = await import("./NoteLayoutSettings");

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

function setup() {
  const appearance = createWritingAppearance({ tabIds: () => ["file_1", "file_2"], load: () => null, save: () => {} });
  const commands = new FeatureCommands();
  registerWritingAppearanceCommands(commands, appearance);
  ctx.value = { appearance, commands, store: { tabs: [{ id: "file_1", name: "Mercury.md" }, { id: "file_2", name: "Tin.md" }] } };
  const root = document.createElement("div"); document.body.append(root);
  const mount = (component: (props: any) => any, props: Record<string, unknown> = {}) => { dispose = render(() => createComponent(component, props), root); };
  const center = () => appearance.apply({ scope: "tab", tabId: "file_1", revision: appearance.state.revision, changes: { alignment: "center", columnWidth: 760 } });
  return { appearance, root, mount, center };
}

describe("Undo for a layout change in the chat", () => {
  it("reverts the change once, then says it was undone", async () => {
    const f = setup();
    const result = JSON.stringify(f.center());
    f.mount(LayoutUndo, { result });
    const button = f.root.querySelector("button")!;
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(f.root.textContent).toBe("Undone"));
    expect(f.appearance.forTab("file_1").alignment).toBe("left");
  });

  it("is disabled once a later layout change has happened", () => {
    const f = setup();
    const result = JSON.stringify(f.center());
    f.appearance.apply({ scope: "tab", tabId: "file_2", revision: f.appearance.state.revision, changes: { lineHeight: 2 } });
    f.mount(LayoutUndo, { result });
    expect(f.root.querySelector("button")!.disabled).toBe(true);
  });
});

describe("Settings › Note layout", () => {
  it("lists notes with their own layout and resets one", async () => {
    const f = setup();
    f.mount(NoteLayoutSettings);
    expect(f.root.textContent).toContain("Every note uses the default layout.");
    f.center();
    await vi.waitFor(() => expect(f.root.textContent).toContain("Mercury.md: its own layout"));
    f.root.querySelector<HTMLButtonElement>('[aria-label="Reset the layout of Mercury.md"]')!.click();
    await vi.waitFor(() => expect(f.root.textContent).toContain("Every note uses the default layout."));
    expect(f.appearance.forTab("file_1").columnWidth).toBe(0);
  });

  it("offers Reset defaults when every note's layout was changed", async () => {
    const f = setup();
    f.appearance.apply({ scope: "app", revision: 0, changes: { lineHeight: 1.8 } });
    f.mount(NoteLayoutSettings);
    expect(f.root.textContent).toContain("Every note: changed defaults");
    [...f.root.querySelectorAll("button")].find(b => b.textContent === "Reset defaults")!.click();
    await vi.waitFor(() => expect(f.root.textContent).toContain("Every note uses the default layout."));
  });
});
