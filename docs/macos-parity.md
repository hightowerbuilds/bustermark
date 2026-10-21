# macOS verification

BusterMark is built for macOS only. This file records what the app includes and
what has been verified natively on the Mac.

The Mac app uses the same tab workspace, ProseMirror Markdown editor,
canvas text editor, spinning blackletter B welcome screen, periodic-table note
names, Appearances/Hotkeys settings, shader background gallery, and Language
Model sidebar. The sidebar runs on Claude Code, with
approval before document edits, saved chat history, per-chat drafts, and web
search through a saved Brave Search key. The integrated terminal is retired.

The Mac workspace also supports an optional two-pane view. **Split View** or a tab's **Open Alongside** menu pairs two notes,
or a note and Settings. Each pane's selector changes that pane's tab. The divider
resizes the pair; **Single View** and the pane expand buttons keep one visible.
Closing either visible tab expands the survivor, and saved sessions restore the
pair, focused tab, and divider width. Editors retain their text and undo history.

The Mac app also prints notes and text documents through a themed confirmation
dialog. Print, File → Print…, and Command-P share the `document print` command
with the Language Model. It captures the live draft, asks for destination and
basic print settings, and waits for confirmation. Save as PDF uses the same
native layout. The dedicated, script-free WebKit document contains only the
note, with formatted Markdown or literal plain text. The backend uses AppKit
and WebKit on macOS 11+; other platform builds report printing unavailable.

The Mac app omits the IDE tooling of earlier builds: Git,
language servers, tree-sitter highlighting, WASM extensions and their sandbox,
the built-in browser, the Console and Problems panels, symbol search, and
breadcrumbs. Sessions that contain those tabs skip them on restore. The canvas
editor remains for plain-text files, without syntax colors or code
intelligence.

Color schemes differ too (October 17): the Mac app removed the VS Code theme
**Import** button and adds schemes the Language Model makes from a description,
checked for readability and saved to a gallery in Settings → Appearances
(`growth/phases/color-schemes.md`).

## Develop and build

Install Rust, Bun, and Xcode Command Line Tools, then run from the repository root:

```sh
bun install --cwd packages/buster-path
bun run --cwd packages/buster-path build
bun install --frozen-lockfile
bun run tauri dev
```

Close an older development instance before restarting. An existing process keeps
its old native services; frontend hot reload alone cannot update those services.

```sh
bun run tauri build --bundles app,dmg
```

The app and disk image are under `src-tauri/target/release/bundle/`.
For a local debug app, use `bun run tauri build --debug --bundles app`.
Releases are for Intel Macs (macOS 11 or later) for now.
`scripts/release-macos-intel.sh` builds the signed, notarized, stapled DMG on this Mac
with an App Store Connect API key. The release workflow is run by hand and refuses
to build without the Developer ID signing and notarization secrets, so a tag push
never publishes an unsigned build.

## Mac behavior

| Control or service | macOS behavior |
| --- | --- |
| Close tab | Command-W or the tab's close button; the last close shows the welcome B |
| Quit | Command-Q or the red window close button; wait for durable session backup |
| Language Model | Command-Shift-A or the right-edge bumper |
| New note / save / settings | Command-N / Command-S / Command-comma |
| Print / Quick Open | Command-P / Command-Option-P |
| Command bar | Control-backtick; try `/help`, `/app status`, or `/notes list`, or type a request |
| API and search keys | Login Keychain; keys stay out of saved settings |
| Read aloud | Native AVSpeechSynthesizer and installed macOS voices |
| Selection lookup | Installed Apple Dictionary dictionaries |
| Clipboard and dictation | Native Edit menu cut/copy/paste selectors |
| Distribution | `.app` and `.dmg` |

Claude uses the installed, signed-in Claude Code CLI. Writing actions use the
provider chosen in AI settings: Claude Code, Codex, or OpenCode, each installed
and signed in. Live model requests and Brave Search require those services to be
configured; ordinary note editing works without them.

## Existing data

The identifier `com.lukehightower.buster` and existing credential service names
are unchanged. Notes, settings, and saved sessions stay in their existing Mac
locations. Version 1 sessions migrate to version 2 with a preserved original
session and unsaved backups. Retired terminal tabs are skipped. Closing cannot
exit the app after a failed session backup.

## Verification

```sh
bunx tsc --noEmit
bun run test
bun run --cwd packages/buster-path test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked
bun run tauri build --debug --bundles app
```

CI checks Rust on macOS only; Clippy runs locally before each push. Frontend tests cover last-tab welcome, editor cleanup, chat persistence,
model transport, note edits, background playback, and session migration.

Verified on an Intel Mac running macOS 26.6.2, Rust 1.97.1, and Bun 1.3.10:
636 frontend tests, 54 path tests, 208 native tests, TypeScript, strict Clippy,
and the debug `.app` build passed. The real WKWebView also passed animation,
Unicode editing, formatting and undo, final-tab close, native shader rendering,
note autosave, saved-chat switching, restart recovery, and clean session-saving
quit checks. The [native smoke harness](../scripts/native-macos-smoke.js) runs
only in isolated test storage; see [its setup](../scripts/README.md).
Model and web-search transports were tested with fixtures rather than paid live requests.

The [split-view native harness](../scripts/native-macos-split-smoke.js) also
passed two-editor editing, focused formatting and undo, independent autosaves,
note-plus-Settings layout, pane selection, Open Alongside, resizing, collapse,
restoring both pane IDs and their width, final-tab welcome, and clean quit.

The [printing native harness](../scripts/native-macos-print-smoke.js) passed
toolbar, File menu, Command-P, Cancel, Escape, validation, captured draft,
editor preservation, model confirmation, model cancellation, and Stop. The
[PDFKit probe](../scripts/verify-print-pdfs.swift) verified an eight-page Letter
portrait PDF, its exact second page exported separately, and an eleven-page A4
landscape PDF, including paper dimensions, Unicode, and the complete draft.
These checks saved PDFs. On 2026-10-20 the
[printer check](../scripts/native-macos-printer-smoke.js) sent one Letter page through
the same dialog to an HP OfficeJet 3830; CUPS completed the job, and the printed page
had its headings, inline formatting, lists, quotation, and Unicode text intact, with no
app controls.

The October 2 optimized Intel `.app` and 14.79 MiB DMG also passed image
verification and inspection of the embedded executable and resources. TypeScript,
636 frontend tests, 54 path tests, and 208 native tests passed again for packaging.
See the [release build log](../growth/build-log/2026-10-02-macos-parity-split-print-dmg.md)
for artifact names, checksum, and signing status.

v0.1.0 (2026-10-20) is the first signed release: an Intel DMG signed with the Developer
ID, notarized by Apple (app and disk image both Accepted), and stapled. Installed from
the DMG and launched from Finder, it opened without a Gatekeeper warning, and Claude
Code connected. See the [Intel release build log](../growth/build-log/2026-10-20-intel-release.md).
