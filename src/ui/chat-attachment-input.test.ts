// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import type { AttachmentDeps } from "../lib/chat-attachments";
import { useChatAttachments, type DropEvent } from "./chat-attachment-input";

function setup() {
  const sidebar = document.createElement("aside");
  sidebar.getBoundingClientRect = () => ({ left: 900, right: 1300, top: 0, bottom: 800, width: 400, height: 800, x: 900, y: 0, toJSON() {} });
  const deps: AttachmentDeps = {
    read: vi.fn(async (path: string) => ({ kind: "text" as const, name: path.split("/").pop()!, text: "hello", bytes: 5 })),
    shrink: vi.fn(async () => ({ mimeType: "image/png", data: "iVBORw0KGgo=", width: 2, height: 2 })),
  };
  let handler!: (event: DropEvent) => void;
  const listen = vi.fn(async (h: (event: DropEvent) => void) => { handler = h; return () => {}; });
  let files!: ReturnType<typeof useChatAttachments>;
  const dispose = createRoot(d => { files = useChatAttachments(() => sidebar, deps, listen); return d; });
  return { files, deps, drop: (event: DropEvent) => handler(event), dispose };
}

describe("chat attachment input", () => {
  it("attaches files dropped on the sidebar and ignores drops elsewhere", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    const f = setup();
    await vi.waitFor(() => expect(typeof f.drop).toBe("function"));
    f.drop({ type: "over", position: { x: 2000, y: 400 } });     // 1000, 200 in CSS pixels: over the sidebar
    expect(f.files.dragging()).toBe(true);
    f.drop({ type: "drop", paths: ["/a/notes.md"], position: { x: 2000, y: 400 } });
    await vi.waitFor(() => expect(f.files.attachments().map(a => a.name)).toEqual(["notes.md"]));
    expect(f.files.dragging()).toBe(false);
    f.drop({ type: "drop", paths: ["/a/elsewhere.md"], position: { x: 200, y: 400 } });
    await Promise.resolve();
    expect(f.deps.read).toHaveBeenCalledTimes(1);
    f.dispose();
  });

  it("turns a pasted screenshot into an attachment without blocking pasted text", async () => {
    const f = setup();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "image.png", { type: "image/png" });
    const paste = (types: string[]) => {
      const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: { types, items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
      f.files.paste(event);
      return event;
    };
    expect(paste(["Files"]).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(f.files.attachments()).toHaveLength(1));
    expect(f.files.attachments()[0]).toMatchObject({ kind: "image", name: "image.png", mimeType: "image/png" });
    expect(paste(["text/plain", "Files"]).defaultPrevented).toBe(false);
    f.dispose();
  });

  it("removes one attachment, and hands all of them over at send time", async () => {
    const f = setup();
    await f.files.attachPaths(["/a/one.md", "/a/two.md"]);
    f.files.remove(f.files.attachments()[0].id);
    expect(f.files.attachments().map(a => a.name)).toEqual(["two.md"]);
    expect(f.files.take().map(a => a.name)).toEqual(["two.md"]);
    expect(f.files.attachments()).toEqual([]);
    f.dispose();
  });
});
