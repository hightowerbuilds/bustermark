import { createSignal, onCleanup, onMount } from "solid-js";
import {
  addAttachments, nativeAttachmentDeps, prepareAttachment, readAttachments, readPastedImage,
  type AttachmentDeps, type ChatAttachment,
} from "../lib/chat-attachments";

/** Tauri's file drop over the window (`onDragDropEvent`); positions are physical pixels. */
export type DropEvent =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

async function listenForDrops(handler: (event: DropEvent) => void): Promise<() => void> {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent(event => handler(event.payload as DropEvent));
}

const PICKABLE = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml",
  "html", "css", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "h", "cpp", "swift", "rb", "sh", "toml", "ini", "log", "tex", "srt", "fountain"];

/**
 * Pending attachments for the Language Model composer: files dropped on the sidebar, images pasted
 * into the message box, and files picked with Attach. Nothing is sent until `take()` at send time.
 */
export function useChatAttachments(sidebar: () => HTMLElement | undefined, deps: AttachmentDeps = nativeAttachmentDeps, listen = listenForDrops) {
  const [attachments, setAttachments] = createSignal<ChatAttachment[]>([]);
  const [error, setError] = createSignal("");
  const [dragging, setDragging] = createSignal(false);

  function accept(incoming: ChatAttachment[], errors: string[]) {
    const added = addAttachments(attachments(), incoming);
    setAttachments(added.attachments);
    setError([...errors, ...added.errors].join(" "));
  }

  async function attachPaths(paths: string[]) {
    if (!paths.length) return;
    const read = await readAttachments(paths, deps);
    accept(read.attachments, read.errors);
  }

  function inside(position: { x: number; y: number }) {
    const rect = sidebar()?.getBoundingClientRect();
    if (!rect) return false;
    const scale = window.devicePixelRatio || 1;
    const x = position.x / scale, y = position.y / scale;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onDrop(event: DropEvent) {
    if (event.type === "leave") { setDragging(false); return; }
    const over = inside(event.position);
    if (event.type === "drop") {
      setDragging(false);
      if (over) void attachPaths(event.paths);
    } else setDragging(over);
  }

  onMount(() => {
    let stop: (() => void) | undefined, disposed = false;
    void listen(onDrop).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    onCleanup(() => { disposed = true; stop?.(); });
  });

  /** A screenshot or copied image pasted into the message box becomes an attachment. */
  function paste(event: ClipboardEvent) {
    const images = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile()).filter((file): file is File => !!file);
    if (!images.length) return;
    if (!event.clipboardData?.types.includes("text/plain")) event.preventDefault();
    void Promise.allSettled(images.map(async (file, i) => prepareAttachment(await readPastedImage(file, file.name || `Pasted image ${i + 1}.png`), deps)))
      .then(results => accept(results.flatMap(r => r.status === "fulfilled" ? [r.value] : []),
        results.flatMap(r => r.status === "rejected" ? ["A pasted image could not be read."] : [])));
  }

  async function pick() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const chosen = await open({ multiple: true, title: "Attach to message", filters: [{ name: "Images and text files", extensions: PICKABLE }] });
    await attachPaths(Array.isArray(chosen) ? chosen : chosen ? [chosen] : []);
  }

  return {
    attachments, error, dragging, attachPaths, onDrop, paste, pick,
    remove: (id: string) => { setAttachments(list => list.filter(a => a.id !== id)); setError(""); },
    /** The attachments for the message being sent; the composer starts empty again. */
    take: () => { const list = attachments(); setAttachments([]); setError(""); return list; },
  };
}
