# The command bar

Status: **COMPLETED** — verified in the native app on October 19. 745 frontend
tests and 54 path tests passed, and the native command bar check passed all 13
of its checks. The plan and its decisions are in
[`growth/phases/phase-4.md`](../phases/phase-4.md).

The Ctrl+` command line, which took raw JSON, is now one line for two purposes.
A line that starts with `/` runs an app command and shows a readable result in
the bar. Anything else is sent to the Language Model sidebar's current chat.

- [x] **COMPLETED** — `src/lib/command-bar.ts`: routing by the leading slash
  (`//` sends a request that starts with one), Decision 2's argument rule (no
  arguments, one string from the rest of the line, or the source tab's ID),
  completion of bar-ready command names, and readable result summaries.
- [x] **COMPLETED** — `src/ui/CommandBar.tsx` replaces `CommandLineSwitchboard.tsx`:
  suggestions with arrow keys and Tab, results with **Raw result** beneath, and
  requests sent through the assistant workspace. A chat that is still answering,
  or a missing or signed-out CLI, keeps the text in the bar and sends nothing.
- [x] **COMPLETED** — `App.tsx` captures the tab the bar opens over, and the
  toolbar has a **/ Command** button beside Print.
- [x] **COMPLETED** — Tests: `command-bar.test.ts` runs the parser against the
  real workbench, note, and document-edit catalogs; `CommandBar.test.ts` drives
  the component in jsdom (commands, requests, a busy chat, a signed-out CLI, and
  Tab completion).
- [x] **COMPLETED** — Docs: README's shortcut table, `docs/internal-commands.md`
  ("Human command entry: the command bar"), and the Mac parity table.

## Native check

`scripts/native-macos-command-bar-smoke.js`, staged with
`python3 scripts/prepare-native-macos-smoke.py command-bar`. It opens the bar from
the toolbar and with Ctrl+`, completes `/notes s` with Tab, runs `/notes search`,
`/frobnicate`, `/document read`, and `/document create`, checks that Escape
returns focus to the note, and sends one small request to Claude Haiku 5.5, which
answered in the sidebar.

## Found in the native check

- **"1 note contain"**: the search summary did not agree with a single match.
  Fixed, with a unit test.
- The first run's Ctrl+` keystroke was sent to `window`, above the workspace's
  hotkey listener, so the bar did not open. Real keystrokes start at the focused
  element; the harness now sends them from there. This was a harness bug only.
- Screenshots were not taken: the terminal that ran the check lacks macOS Screen
  Recording permission. The harness still pauses at `suggestions` and `result`
  for an outside capture.

## Still open

- Whether the bar replaces the local search portal.
- `/note open` end to end in the native app (its parse is unit-tested).
- Rerunning the selection, Spread, review, and speech smokes with the bar in place.
- `selection ai` cannot be typed in the bar; see the follow-up in the plan.
