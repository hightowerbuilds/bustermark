# Attachments in the Language Model chat

Status: **BUILT** (2026-10-17). Sections 1 and 2 are implemented and tested; a drop in the native app with each provider remains (section 3).

Drag images and other files into the Language Model sidebar, paste a screenshot,
or pick files with an **Attach** button. Attachments show as chips above the
composer and go out with the next message; nothing is sent until the writer sends.

## What exists today

- No drag-and-drop handling anywhere in the app. Tauri v2 delivers OS file drops
  to the webview as `onDragDropEvent` (paths and a position), not as DOM `File`s.
- `assistant_send` passes only text: Claude Code gets
  `{"type":"user","message":{"content": text}}` on stdin; Codex reads the text on
  stdin (`codex exec`); OpenCode gets it as an argument (`opencode run`).
- Verified 2026-10-17: Claude Code accepts image content blocks in its stream-json
  input (a 16×16 red PNG with Haiku answered "Red"); `codex exec` has
  `-i/--image FILE`; `opencode run` has `-f/--file FILE`.

## Decisions

- **Images go to the model as images; text files go inline.** Images are shrunk to
  1568 px (the `image view` path) and sent as content blocks to Claude Code and as
  temporary files to Codex (`-i`) and OpenCode (`-f`). Text files (UTF-8, no NUL
  bytes) are added to the message as a fenced block with the file name, which
  works the same for all three.
- **Limits:** up to 8 attachments per message; images up to 20 MB before
  shrinking; text files up to 256 KB each and 512 KB in all. Anything else (PDF,
  Word, archives) is refused with a clear message; PDFs are a follow-up.
- **The writer chooses what is sent.** A drop or paste only adds a chip; each chip
  can be removed; the sidebar says the files go to the chosen provider.
- **Saved chats keep names, not contents.** The user message shows the attachment
  names and image thumbnails while the app is open; history keeps the names.
- **Temporary files** for Codex and OpenCode live in the app cache folder per
  conversation and are deleted when the next turn starts or the chat is reset.

## 1 — Sending attachments

- [x] **COMPLETED** — `SendRequest.images: [{ name, mimeType, data }]`, checked like tool images.
  Claude Code: a content array (images, then the text). Codex and OpenCode: write
  each image to the conversation's temporary folder and pass `-i`/`-f`. Rust tests
  for the content shape and the arguments.
- [x] **COMPLETED** — Rust `chat_attachment_read(path)`: reads a dropped or picked file with the
  limits above, returning an image (by magic bytes) or text, or a refusal.
- [x] **COMPLETED** — `src/lib/chat-attachments.ts`: turn files into attachments (shrink images,
  check text), format text files into the message, enforce the limits. Tests.

## 2 — Composer

- [x] **COMPLETED** — Attachment chips above the composer (name, thumbnail for images, size,
  remove ×); Send is allowed with attachments and no text.
- [x] **COMPLETED** — The sent user message shows the attachment names and thumbnails.
- [x] **COMPLETED** — Drag and drop: `onDragDropEvent` over the sidebar highlights it and adds the
  files on drop; drops elsewhere are ignored.
- [x] **COMPLETED** — Paste: an image on the clipboard pasted into the composer becomes a chip.
- [x] **COMPLETED** — **Attach** button: a file picker for the same types.

## 3 — Verification

- [x] **COMPLETED** — Unit and Rust tests; `bunx tsc --noEmit` (722 frontend, 88 Rust).
- [ ] Live, in the app: drop an image and a text file and send them to Claude
  Code, Codex, and OpenCode. Checked from the command line on 2026-10-17 with a
  16×16 red PNG: Claude Code (stream-json image block) and Codex (`--image=`) both
  answered "Red"; OpenCode (`--file=`) received it, but its default model said it
  can't view images, so the sidebar notes that OpenCode needs a vision model.
- [x] **COMPLETED** — Docs: `docs/internal-commands.md` (Assistant sidebar), README.
