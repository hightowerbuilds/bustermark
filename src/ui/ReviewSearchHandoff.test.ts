// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";

const mock = vi.hoisted(() => ({
  draft: "", webReady: false,
  setDraft: vi.fn(), setOpen: vi.fn(), createAiTab: vi.fn(), dispatch: vi.fn(async () => ({ ok: true, data: {} })),
}));
vi.mock("../lib/web-search", () => ({ webSearchConfigured: async () => mock.webReady }));
vi.mock("../lib/buster-context", () => ({ useBuster: () => ({
  store: { settings: { ai_provider: "claude" }, tabs: [{ id: "file_1", name: "Tin.md" }] },
  actions: { createAiTab: mock.createAiTab },
  commands: { dispatch: mock.dispatch },
  assistant: { state: { get draft() { return mock.draft; } }, setDraft: (text: string) => { mock.draft = text; mock.setDraft(text); }, setOpen: mock.setOpen },
  writing: {
    reviews: { r1: { kind: "ai", status: "completed", output: "The lamp swayed.", provider: "claude", model: "",
      target: { tabId: "file_1", text: "The lamp swung.", range: { anchor: { line: 0 } } } } },
    stale: () => false,
  },
  search: {
    portals: { p1: { query: "harbor lamp", source: null, status: "ready", results: [], searchedNotes: 0, skippedNotes: 0, truncated: false } },
    stale: () => false,
  },
}) }));
const { default: WritingReviewPanel } = await import("./WritingReviewPanel");
const { default: SearchPortal } = await import("./SearchPortal");

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); mock.draft = ""; mock.webReady = false; vi.clearAllMocks(); });
function mount(component: (props: any) => any, props: Record<string, unknown>) {
  const root = document.createElement("div"); document.body.append(root);
  dispose = render(() => createComponent(component, props), root);
  return root;
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll("button")].find(b => b.textContent === text);

describe("review and search hand-offs", () => {
  it("Discuss in chat drafts the passage and the result without sending", () => {
    const root = mount(WritingReviewPanel, { reviewId: "r1" });
    button(root, "Discuss in chat")!.click();
    expect(mock.draft).toContain("About this passage from Tin.md:\n\n> The lamp swung.");
    expect(mock.draft).toContain("> The lamp swayed.");
    expect(mock.setOpen).toHaveBeenCalledWith(true);
    expect(mock.dispatch).not.toHaveBeenCalled();
  });

  it("the portal asks the Language Model with its query, and offers web search setup without a key", async () => {
    const root = mount(SearchPortal, { portalId: "p1" });
    expect(root.textContent).not.toContain("Model and web search will arrive");
    button(root, "Ask the Language Model")!.click();
    expect(mock.draft).toBe('Find "harbor lamp" in my notes and open it with the phrase selected.');
    await vi.waitFor(() => expect(button(root, "Set up web search")).toBeDefined());
    button(root, "Set up web search")!.click();
    expect(mock.createAiTab).toHaveBeenCalled();
    expect(mock.dispatch).not.toHaveBeenCalled();
  });

  it("the portal searches the web through the Language Model when a key is saved", async () => {
    mock.webReady = true;
    const root = mount(SearchPortal, { portalId: "p1" });
    await vi.waitFor(() => expect(button(root, "Search the web")).toBeDefined());
    button(root, "Search the web")!.click();
    expect(mock.draft).toBe('Search the web for "harbor lamp" and summarize what you find, with sources.');
  });
});
