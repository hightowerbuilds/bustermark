// Files the writer attaches to a Language Model message: dropped, pasted, or picked
// (growth/phases/chat-attachments.md). Images go to the model as images; text files are added to
// the message itself, which every provider reads the same way.

import { invoke } from "@tauri-apps/api/core";
import type { ToolImage } from "./assistant-transport";
import { shrinkImage, type FetchedImage, type ShrunkImage } from "./image-commands";

export type ChatAttachment =
  | { id: string; kind: "image"; name: string; mimeType: string; data: string; width: number; height: number; bytes: number }
  | { id: string; kind: "text"; name: string; text: string; bytes: number };

/** What Rust returns for a dropped or picked file (`chat_attachment_read`). */
export type ReadAttachment =
  | { kind: "image"; name: string; mimeType: string; data: string; bytes: number }
  | { kind: "text"; name: string; text: string; bytes: number };

export const MAX_ATTACHMENTS = 8;
export const MAX_TEXT_TOTAL = 512 * 1024;
const SENDABLE = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface AttachmentDeps {
  read(path: string): Promise<ReadAttachment>;
  shrink(image: FetchedImage): Promise<ShrunkImage>;
}

export const nativeAttachmentDeps: AttachmentDeps = {
  read: path => invoke<ReadAttachment>("chat_attachment_read", { path }),
  shrink: image => shrinkImage(image, undefined, !SENDABLE.includes(image.mimeType)),
};

const newId = () => crypto.randomUUID();

/** A read file as an attachment: images are shrunk (and HEIC re-encoded) before they are kept. */
export async function prepareAttachment(file: ReadAttachment, deps: AttachmentDeps): Promise<ChatAttachment> {
  if (file.kind === "text") return { id: newId(), ...file };
  const shrunk = await deps.shrink({ mimeType: file.mimeType, data: file.data, bytes: file.bytes, source: file.name });
  return { id: newId(), kind: "image", name: file.name, mimeType: shrunk.mimeType, data: shrunk.data, width: shrunk.width, height: shrunk.height, bytes: file.bytes };
}

/** Read and prepare dropped or picked paths; each failure becomes a message instead of stopping the rest. */
export async function readAttachments(paths: string[], deps: AttachmentDeps = nativeAttachmentDeps): Promise<{ attachments: ChatAttachment[]; errors: string[] }> {
  const results = await Promise.allSettled(paths.map(async path => prepareAttachment(await deps.read(path), deps)));
  return {
    attachments: results.flatMap(r => r.status === "fulfilled" ? [r.value] : []),
    errors: results.flatMap(r => r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : []),
  };
}

/** Base64 of a pasted image, for the same path as a dropped one. */
export async function readPastedImage(file: Blob, name: string): Promise<ReadAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { kind: "image", name, mimeType: file.type, data: btoa(binary), bytes: bytes.length };
}

/** Add attachments within the limits; what doesn't fit is reported, not silently dropped. */
export function addAttachments(current: ChatAttachment[], incoming: ChatAttachment[]): { attachments: ChatAttachment[]; errors: string[] } {
  const attachments = [...current];
  const errors: string[] = [];
  let textTotal = current.reduce((sum, a) => sum + (a.kind === "text" ? a.bytes : 0), 0);
  for (const attachment of incoming) {
    if (attachments.length >= MAX_ATTACHMENTS) { errors.push(`A message can carry ${MAX_ATTACHMENTS} attachments; ${attachment.name} was left out.`); continue; }
    if (attachment.kind === "text" && textTotal + attachment.bytes > MAX_TEXT_TOTAL) { errors.push(`${attachment.name} would bring the attached text over 512 KB.`); continue; }
    if (attachment.kind === "text") textTotal += attachment.bytes;
    attachments.push(attachment);
  }
  return { attachments, errors };
}

/** A fence longer than any run of backticks in the text, so a file can't close it early. */
function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
  return "`".repeat(longest + 1);
}

/** The message the model receives: the writer's words, then each text file; images travel separately. */
export function composeMessage(text: string, attachments: ChatAttachment[]): { text: string; images: ToolImage[] } {
  const files = attachments.filter(a => a.kind === "text").map(a => {
    const marks = fence(a.text);
    return `Attached file: ${a.name}\n${marks}\n${a.text}\n${marks}`;
  });
  const words = text.trim() || (attachments.length === 1 ? "Here is the attached file." : "Here are the attached files.");
  return {
    text: [words, ...files].join("\n\n"),
    images: attachments.flatMap(a => a.kind === "image" ? [{ mimeType: a.mimeType, data: a.data }] : []),
  };
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
