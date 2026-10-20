# Phase 3 — Claude and Codex connections

Status: **IN PROGRESS — Claude Code, Codex, and OpenCode all drive the Assistant end to end (verified live 2026-10-12). The finishing plan below (2026-10-17) covers appearance through the Assistant, review and search hand-offs, phrase search, and failure paths.**

Give writers a clear UI for choosing **Claude**, **Codex**, or **OpenCode**,
connecting the chosen assistant, and using it to operate BusterMark's writing
features through the shared internal command service. Tractor Beam is the
development host; these connections belong to the BusterMark app being built here.

## Confirmed direction

- A visible provider choice (Claude Code, Codex, OpenCode), with separate
  connection state for each.
- Guided connection setup, status, and a "Check again" control.
- The chosen assistant runs writing assistance and uses implemented app commands.
- Keep the Tauri/Rust–SolidJS split. (The integrated terminal was retired on
  2026-10-11.)
- Reuse the command catalog for documents, formatting, search, appearance, and
  saved appearances.

## Connection design and implementation

The first build used `agent *` catalog commands and `src-tauri/src/mcp.rs`. The
2026-10-11 cleanup replaced them: the Assistant sidebar now runs through
`src-tauri/src/commands/assistant.rs` (`assistant_status`, `assistant_send`,
`assistant_interrupt`, `assistant_reset`), which also hosts the loopback MCP
server, and one-shot writing actions run through `src-tauri/src/commands/ai_cli.rs`.
The items below record what was built; where names changed, the current ones
are given.

- [x] **COMPLETED** — Verified against the installed CLIs. The connection uses each
  assistant's headless command-line mode: `claude -p --input-format stream-json`,
  `codex exec --json`, and `opencode run --format json`. Each owns its sign-in, so
  BusterMark stores no assistant credential.
- [x] **COMPLETED** — `assistant_status` reports whether the CLI is installed and
  signed in without a model request (`claude auth status`, `codex login status`).
- [x] **COMPLETED** — The sidebar's setup view shows the sign-in command to run
  when signed out, with **Check again**. Model choice is a per-chat picker.
- [x] **COMPLETED** — Sign-in happens in each CLI (`claude`, `codex login`,
  `opencode auth login`). The app reads status only; it never stores, forwards,
  or infers a credential, and strips API-key variables from the spawn.
- [x] **COMPLETED** — Send, interrupt, and reset. Child processes run in their own
  process group and are killed on Stop, reset, and drop.

## Assistant-to-app command loop

- [x] **COMPLETED** — The catalog is published as MCP tools by a loopback HTTP server
  (now in `assistant.rs`) bound to 127.0.0.1 on an OS-assigned port, with a bearer
  token per session. Catalog names are underscored into tool names.
- [x] **COMPLETED** — Tool calls run through the existing dispatcher as the `ai`
  caller, so an assistant reaches nothing the writer's own controls cannot.
  `src/lib/assistant-tools.ts` withholds commands that drive human-facing panels,
  the clipboard, or the app's look.
- [x] **COMPLETED** — Calls inherit the dispatcher's schema validation, revision
  checks and request-ID deduplication unchanged. Write calls that would fail are
  returned to the model before the writer is asked.
- [x] **COMPLETED** (2026-10-12) — The composer says where messages go ("to
  OpenAI through Codex on your subscription") and that notes are shared only
  through the actions listed in the chat; each read the model received is marked
  "sent to Codex". Running actions, approvals, Stop, and results show in the chat.
- [x] **COMPLETED** (2026-10-12) — Changes wait for Allow or Deny with a before/after
  view, and an allowed edit undoes in one step.
- [x] **COMPLETED** (2026-10-12) — Codex and OpenCode in the sidebar. A Provider
  picker sits beside Model and Effort; a chat keeps its provider, new chats take
  the last one (the first takes Settings › AI). Codex runs `codex exec --json`
  per message (resuming its thread) with the shell, apps, plugins, web search,
  and user config off and only BusterMark's MCP server, pre-approved there so the
  app asks the writer instead. OpenCode runs `opencode run --format json` per
  message (`--session`) with a `bustermark` agent whose only tools are
  BusterMark's. Switching provider mid-chat starts fresh there and says so.
- [x] **COMPLETED** (2026-10-17) — Color schemes and note backgrounds are made
  through the Assistant with a preview on the approval card
  ([color schemes](color-schemes.md)).

## Acceptance examples (completed)

- [x] **COMPLETED** — Connect Claude, edit a note after approval, and undo
  (`scripts/native-macos-assistant-smoke.js`, live on the writer's subscription).
- [x] **COMPLETED** — Codex and OpenCode run the same workflow through their adapters.
- [x] **COMPLETED** (2026-10-12) — Live end-to-end tests with each connection: 30
  checks across Claude Code (Haiku 5.5, ~2.5s per read), Codex (~9s), and OpenCode
  (~9s). Nothing there is mocked. Deny, Stop, and switching provider are verified
  live on Claude.

Writing actions (Rephrase, Spelling, selection review) run one-shot through the
writer's Claude Code, Codex, or OpenCode subscription, following Settings › AI.
Claude Code's headless runs cannot answer a permission prompt, so its spawn
allows only BusterMark's MCP tools; Codex and OpenCode get the same server with
their own tools switched off.

---

# Finishing Phase 3 (planned 2026-10-17)

Four items remained open. What the code does today, from a survey on 2026-10-17:

- **Appearance.** `src/lib/writing-appearance.ts` registers `appearance *` and
  `effects *` commands (apply, reset, revert, preview, presets, effects) with
  revision checks (`STALE_APPEARANCE`) and a 20-entry in-memory revert history.
  All of them are withheld from the Assistant (`EXCLUDED_PREFIXES` in
  `assistant-tools.ts`, asserted in `assistant.test.ts`). **No visible appearance
  UI remains**: the layout controls were deleted in fed0947, so the only way to
  revert is typing `appearance revert` in the command line.
- **Review and search.** Selection review already runs on the Settings › AI
  provider through `ai_cli.rs`, but has no link to the sidebar. The search portal
  searches open notes locally, with no model involved, and still shows the
  placeholder "Model and web search will arrive with the AI connection workflow."
  `web search` (Brave) is an Assistant tool; the portal and review don't use it.
- **Phrase search.** Already possible: the Assistant has `notes search`,
  `note open`, `document read`, and `selection set`, the same path the Spread
  menu's Search uses. It has never been checked live.
- **Failure paths.** Unit tests cover Stop, unexpected exits, send failures,
  sign-in states, and provider switching. Gaps: a result or exit error mid-turn
  does not re-check the connection, so an expired sign-in leaves the status dot
  green; no test feeds a `STALE_*` error through `runTool`; the Rust side has no
  spawn or exit tests; and a native test cannot simulate a missing CLI because
  `find_cli` falls back to a login shell and fixed install paths.

## Decisions

- **The Assistant gets a curated set of appearance commands**, not all of them:
  `appearance capabilities`, `inspect`, `apply`, `reset`, `revert`,
  `presets list`, and `presets apply`. Previews, preset save/delete, and
  `effects *` stay withheld: previews are a UI affordance, and presets are the
  writer's to manage.
- **Tab scope unless the writer says otherwise.** The tool description and
  system prompt tell the model to change the current note (`scope: "tab"`,
  session-only) unless the writer asks for every note ("always", "from now on"),
  which uses `app`.
- **Revert lives where the change was made.** An allowed appearance change gets
  an **Undo** button on its row in the chat, which runs `appearance revert`. A
  **Note layout** row in Settings › Appearances shows whether the current note
  has overrides, with **Reset**. No separate appearance panel comes back.
- **Hand-offs, not hidden model calls.** The search portal stays local and never
  sends text to a model on its own. Review and search get explicit buttons that
  open the sidebar with a drafted request; the writer sends it. This keeps
  Phase 2's local search separate from model and web search.
- **A debug-only CLI override for failure tests.** `find_cli` honors
  `BUSTERMARK_CLI_DIR` only in debug builds (`cfg(debug_assertions)`): when set,
  it looks there and nowhere else. Release builds ignore it.

## 1 — Appearance through the Assistant — built 2026-10-17; live check in section 5

- [x] **COMPLETED** — Allow the curated commands in `assistant-tools.ts`: replace the
  `"appearance "` / `"effects "` prefixes with an explicit withheld list
  (`appearance preview`, `appearance preview cancel`, `appearance presets save`,
  `appearance presets delete`, and `effects *`). Update the exclusion test.
- [x] **COMPLETED** — Teach the model: `appearance apply`'s description names the fields with
  their ranges and the tab-versus-app rule, and says to call `appearance inspect`
  first for the current revision and to retry after `STALE_APPEARANCE`.
- [x] **COMPLETED** — An approval card in plain words: "Center this note at 760px with 1.8 line
  spacing?" for `apply`, "Use Reading room for this note?" for `presets apply`,
  "Reset this note's layout?" for `reset` (`src/lib/appearance-approval.ts`; the card
  lists each change, e.g. "Centered column", "760 px column", "Line spacing 1.8").
  The column mock was left out: the list reads clearly on its own.
- [x] **COMPLETED** — **Undo** on an allowed appearance row in the chat. It runs `appearance
  revert` with the current revision, then shows "Undone" (disabled once the
  history entry is gone or the layout has changed since).
- [x] **COMPLETED** — Settings › Writing › **Note layout** (`src/ui/NoteLayoutSettings.tsx`):
  each note, the folder, or the defaults that have their own layout, each with
  **Reset**; otherwise "Every note uses the default layout." (Settings is itself a
  tab, so "the current note" is ambiguous there; listing them is clearer.)
- [x] **COMPLETED** — Docs: `docs/internal-commands.md` drops the deleted appearance dialog
  ("Closing the appearance dialog cancels its own preview") and names the
  Assistant's subset.
- [x] **COMPLETED** — Tests: the curated tools are exposed and the rest withheld; approval card
  wording for each command; Undo reverts once and then disables; Settings Reset.

## 2 — Review and search hand-offs to the Assistant — built 2026-10-17; live check in section 5

- [x] **COMPLETED** — Selection review panel: **Discuss in chat** opens the sidebar with a draft
  that quotes the passage (trimmed to a limit) and the review's output, then
  focuses the composer. Nothing is sent until the writer sends it.
- [x] **COMPLETED** — Search portal: replace the placeholder with two actions on the current
  query: **Ask the Language Model** (drafts "Find "query" in my notes and open
  it") and, when a Brave key is saved, **Search the web** (drafts a web search
  request). Without a key, it links to Settings › AI › Web search.
- [x] **COMPLETED** — Rename the portal tab from "AI search" to "Search" now that it is plainly
  local.
- [x] **COMPLETED** — Tests: each hand-off drafts the right text, keeps an existing draft
  (as **Describe a scheme…** does), and sends nothing by itself.
- [x] **COMPLETED** — One helper drafts every hand-off (`src/lib/assistant-handoff.ts`), shared
  with **Describe a scheme…**: an existing draft is kept (scheme) or added to (review,
  search). `docs/internal-commands.md` no longer claims the Assistant opens the
  portal (`search *` is withheld; it uses `notes search`).
- Note: the portal and AI review are reached only from the command line
  (`search portal open`, `selection ai`) or the portal's **AI review…**; the Spread
  menu's Search uses `notes search` directly. Discoverability is a Phase 4 question
  (the AI command bar).

## 3 — Phrase search, checked live

- [x] **COMPLETED** — The system prompt names the path for "find X in my notes": `notes search`,
  `note open`, then `selection set` on the match.
- [ ] Live check (in the Phase 3 smoke, section 5): two notes on disk, one
  containing a phrase; ask the Assistant to find and open it; the right note
  opens with the phrase selected.

## 4 — Failure paths

- [x] **COMPLETED** — Re-check the connection after a `result` error or an unexpected `exit`, so
  an expired sign-in flips the status and shows the setup view with the sign-in
  command. A failed send, a failed `result` (unless the writer stopped it), and an
  unexpected `exit` each re-check; `assistant.test.ts` covers both new paths.
- [x] **COMPLETED** — `find_cli`: honor `BUSTERMARK_CLI_DIR` in debug builds only (see Decisions).
  Rust tests for the override and for its absence in release logic
  (`cli_dir_override_is_debug_only_and_exclusive` in `ai_cli.rs`).
- [ ] Rust tests for the spawn and exit path with a fake CLI script: missing
  binary message, nonzero exit with stderr detail, non-JSON lines skipped.
- [x] **COMPLETED** — Frontend test: a `STALE_REVISION` from an approved `document edit` returns
  to the model as an error, marks the row failed, and leaves the note unchanged.
- [ ] Fake CLIs for the native check (`scripts/fake-cli/`): `claude` variants that
  report signed out, exit with an error mid-turn, and answer "Not logged in" in a
  result; an empty directory for "not installed".

## 5 — Verification

- [ ] `scripts/native-macos-phase3-smoke.js` (staged with
  `prepare-native-macos-smoke.py phase3`), on the real Claude CLI with Haiku:
  - appearance: "center this note and loosen the line spacing" → approval card →
    Allow → layout changes → Undo in the chat restores it; "use Reading room" →
    Settings › Note layout → Reset;
  - phrase search (section 3);
  - hand-offs: Discuss in chat and Ask the Language Model draft without sending;
  - stale revision: the harness types into the note while an edit waits for
    approval; Allow returns `STALE_REVISION` to the model, which re-reads and
    asks again.
- [ ] A second launch with `BUSTERMARK_CLI_DIR` pointing at the fake CLIs (no
  model requests): not installed, signed out, a crash mid-turn, and an expired
  sign-in mid-turn each show the right notice and setup view, and **Check
  again** recovers once the directory is switched back.
- [ ] Screenshots of each approval card and failure state, held for an outside
  capture as in the color scheme smoke.
- [ ] Unit, Rust, and path tests pass; README and `docs/internal-commands.md`
  updated; build log entry; Phase 3 marked complete.

## Open questions for the writer

- Should the Assistant also manage presets (save and delete) and effects (focus
  dimming, cursor glow, grain)? The plan withholds them.
- Is the search portal worth keeping now that the Spread menu's Search and the
  Assistant both find phrases? The plan keeps it, local, with hand-offs.

The next milestone is [Phase 4 — AI command bar and assistant chat panes](phase-4.md),
which replaces the AI search entry point with a single input that either runs an
app command or opens an assistant conversation. It depends on the connection and
tool loop specified here.
