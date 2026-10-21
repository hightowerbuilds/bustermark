import { describe, it, expect, vi } from "vitest";
import { createEditorEngine } from "../editor/engine";
import { setupFileWatcher } from "./file-watcher";
const mocks = vi.hoisted(() => ({ receive: null as any, read: vi.fn(), known: vi.fn((_path: string): string | undefined => undefined), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name, receive) => { mocks.receive = receive; return mocks.unlisten; }) }));
vi.mock("./ipc", () => ({ readFile: mocks.read, knownDiskContent: mocks.known }));
vi.mock("../ui/CanvasToasts", () => ({ showToast: vi.fn() }));
describe("external file changes", () => {
 it("ignores stale reads and preserves a dirty sibling while refreshing clean views", async () => {
  const clean = createEditorEngine("original"), dirty = createEditorEngine("original");
  dirty.insert("mine");
  const conflicts = vi.fn();
  const stop = await setupFileWatcher({ getTabs: () => [
   { id: "clean", type: "file", name: "note", path: "/note.md" },
   { id: "dirty", type: "file", name: "note", path: "/note.md" },
  ] as any, getEngine: id => id === "clean" ? clean : dirty, showConflictDialog: conflicts });
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce({content: "newest"});
  const first = mocks.receive({payload: {path: "/note.md"}});
  await mocks.receive({payload: {path: "/note.md"}});
  resolve({content: "outdated"}); await first;
  expect(clean.getText()).toBe("newest");
  expect(dirty.getText()).toContain("mine");
  expect(conflicts).toHaveBeenCalledExactlyOnceWith("dirty", "note", "newest");
  stop(); clean.dispose(); dirty.dispose();
 });
 it("ignores the app's own create reported late, but not a real change after it", async () => {
  const engine = createEditorEngine("");
  engine.insert("typed right away");
  const conflicts = vi.fn();
  const stop = await setupFileWatcher({getTabs: () => [{id: "new", type: "file", name: "Neon.md", path: "/Neon.md"}] as any,
   getEngine: () => engine, showConflictDialog: conflicts});
  mocks.known.mockReturnValue("");
  mocks.read.mockResolvedValueOnce({content: ""});
  await mocks.receive({payload: {path: "/Neon.md"}});
  expect(conflicts).not.toHaveBeenCalled();
  expect(engine.getText()).toBe("typed right away");
  mocks.read.mockResolvedValueOnce({content: "from another app"});
  await mocks.receive({payload: {path: "/Neon.md"}});
  expect(conflicts).toHaveBeenCalledExactlyOnceWith("new", "Neon.md", "from another app");
  mocks.known.mockReset(); stop(); engine.dispose();
 });
 it("does not reload a closed note after the disk read completes", async () => {
  const engine = createEditorEngine("keep");
  let tabs: any[] = [{id: "note", type: "file", path: "/note.md"}];
  const stop = await setupFileWatcher({getTabs: () => tabs, getEngine: () => engine, showConflictDialog: vi.fn()});
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(r => {resolve = r;}));
  const read = mocks.receive({payload: {path: "/note.md"}});
  tabs = []; resolve({content: "late"}); await read;
  expect(engine.getText()).toBe("keep"); stop(); engine.dispose();
 });
});
