// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DecorationSet, EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { createEditorEngine } from "./engine";
import { createBlockEditor } from "./block-editor";
import { asciiArtDecorations } from "./ascii-art";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
const views: EditorView[] = [];
afterEach(() => { views.forEach(v => v.destroy()); views.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); });
function mounted(source = "", courier = false) {
  const engine = createEditorEngine(source);
  const root = document.createElement("div"); document.body.append(root);
  let view: EditorView | undefined;
  const editor = createBlockEditor(engine, state => view?.updateState(state));
  const seen = new Set<string>();
  view = new EditorView(root, { state: editor.state, dispatchTransaction: tr => editor.dispatch(tr),
    decorations: courier ? state => DecorationSet.create(state.doc, [...asciiArtDecorations(state.doc, seen)]) : undefined });
  views.push(view);
  return { engine, editor, view, root };
}
function key(view: EditorView, name: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: name, ...extra });
  view.someProp("handleKeyDown", handler => handler(view, event));
}
describe("block editing DOM", () => {
  it("adds and removes Courier caps across the cutoff without changing text, caret, or undo", () => {
    // Exercise ProseMirror's widgets and hidden text; canvas painting needs WebKit.
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const text = "A".repeat(39);
    const f = mounted(text, true);
    f.view.dispatch(f.view.state.tr.setSelection(TextSelection.atEnd(f.view.state.doc)));
    expect(f.root.querySelector(".ascii-art, .drop-cap-letter")).toBeNull();
    f.view.dispatch(f.view.state.tr.insertText("b"));
    expect(f.root.querySelectorAll(".ascii-cap")).toHaveLength(1);
    expect(f.root.querySelector(".drop-cap-letter")?.textContent).toBe("A");
    expect(f.root.textContent).toBe(text + "b");
    expect(f.engine.getText()).toBe(text + "b");
    expect(f.engine.cursor()).toEqual({ line: 0, col: 40 });
    f.engine.beginUndoGroup();
    f.view.dispatch(f.view.state.tr.insertText("Page 12", 1, f.view.state.doc.firstChild!.nodeSize - 1));
    f.engine.endUndoGroup();
    expect(f.root.querySelector(".ascii-art, .drop-cap-letter")).toBeNull();
    expect(f.root.textContent).toBe("Page 12");
    expect(f.engine.getText()).toBe("Page 12");
    expect(f.engine.cursor()).toEqual({ line: 0, col: 7 });
    f.engine.undo(); f.editor.sync();
    expect(f.root.textContent).toBe(text + "b");
    expect(f.root.querySelectorAll(".ascii-cap")).toHaveLength(1);
    expect(f.engine.cursor()).toEqual({ line: 0, col: 40 });
    f.engine.redo(); f.editor.sync();
    expect(f.root.textContent).toBe("Page 12");
    expect(f.root.querySelector(".ascii-art, .drop-cap-letter")).toBeNull();
  });

  it("renders editable headings, paragraphs and lists without Markdown markers", () => {
    const f = mounted("# A heading\n\nSome **bold** and *italic*.\n\n- first\n- second");
    expect(f.view.dom.getAttribute("contenteditable")).toBe("true");
    expect(f.root.querySelector("h1")?.textContent).toBe("A heading");
    expect(f.root.querySelector("strong")?.textContent).toBe("bold");
    expect(f.root.querySelector("em")?.textContent).toBe("italic");
    expect(f.root.querySelectorAll("li")).toHaveLength(2);
    expect(f.root.textContent).not.toContain("**");
  });
  it("retains native selection across toolbar formatting and edits only that passage", () => {
    const f = mounted("One two three");
    f.view.focus();
    f.editor.dispatch(f.editor.state.tr.setSelection(TextSelection.create(f.editor.state.doc, 5, 8)));
    expect(document.getSelection()?.toString()).toBe("two");
    f.editor.format("italic");
    expect(document.getSelection()?.toString()).toBe("two");
    f.view.dispatch(f.view.state.tr.insertText("new"));
    expect(f.engine.getText()).toBe("One *new* three");
    expect(f.root.querySelector("em")?.textContent).toBe("new");
  });
  it("creates and exits list items with Enter, and handles undo/redo", () => {
    const f = mounted("- first");
    f.view.dispatch(f.view.state.tr.setSelection(TextSelection.atEnd(f.view.state.doc)));
    key(f.view, "Enter");
    expect(f.view.state.doc.firstChild?.childCount).toBe(2);
    f.view.dispatch(f.view.state.tr.insertText("second"));
    expect(f.engine.getText()).toContain("second");
    key(f.view, "Enter"); key(f.view, "Enter");
    expect(f.view.state.doc.lastChild?.type.name).toBe("paragraph");
    key(f.view, "z", { ctrlKey: true });
    key(f.view, "z", { ctrlKey: true, shiftKey: true });
    expect(f.view.state.doc.lastChild?.type.name).toBe("paragraph");
  });
  it("pastes rich text using schema nodes and saves Markdown", () => {
    const f = mounted();
    f.view.pasteHTML("<h2>Title</h2><p>Some <strong>bold</strong> writing.</p>", new Event("paste") as ClipboardEvent);
    expect(f.engine.getText()).toContain("## Title");
    expect(f.engine.getText()).toContain("**bold**");
    expect(f.engine.getText()).not.toContain("<strong>");
  });
  it("keeps notes independent when multiple panes are open", () => {
    const a = mounted("First"), b = mounted("Second");
    a.view.dispatch(a.view.state.tr.insertText("!"));
    expect(a.engine.getText()).toBe("!First");
    expect(b.engine.getText()).toBe("Second");
    expect(b.root.textContent).toBe("Second");
  });
});
