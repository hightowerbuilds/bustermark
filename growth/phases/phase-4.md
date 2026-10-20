# Phase 4 — AI command bar

Status: **PLANNED — rewritten 2026-10-19.** Phase 3's assistant connection and
tool loop are built, so this phase is no longer blocked on them.

Turn the Ctrl+` command line into the one place a writer types to BusterMark.
A line that starts with `/` runs an app command and reports the result in the
bar. Anything else is sent as a message to the Language Model sidebar, which
already streams replies, shows tool calls, and asks for approval.

## Why this was rewritten

The first plan (September) predates the Mac app's current shape. It no longer
matched the code:

- It described "assistant chat panes" and a six-pane limit. The Mac app uses
  tabs, split view, and a right-hand Language Model sidebar that already
  covers the chat side: streamed text and thinking, tool calls and results,
  approval cards with diffs, Stop, and multiple saved chats.
- It said the Ctrl+` command line had been removed. That happened on Linux; the
  Mac app still has it (`src/ui/CommandLineSwitchboard.tsx`), and it takes raw
  JSON arguments.
- It said the toolbar's AI button opens the search portal. The toolbar now has
  only Print and Split View; the portal opens through `search portal open`.

Chat panes are dropped. The bar sends requests to the sidebar instead.

## What already exists

- `FeatureCommands.executeLine` parses `name {json}` and dispatches as the
  `user` caller, with schema validation and request-ID deduplication.
- `CommandLineSwitchboard.tsx` (Ctrl+`): an overlay input, inline results shown
  as raw JSON, example buttons, and AI/Settings shortcuts.
- The assistant workspace's `send(text)` posts a message to the active chat;
  `openAssistantWithDraft` (`assistant-handoff.ts`) drafts one without sending.
- Connection status per chat (`assistant.state.connection`) and the setup view
  for a missing or signed-out CLI.

## Decisions (2026-10-19)

1. **Routing: a leading `/` means a command.** Everything else is a request.
   This is predictable, needs no model, and cannot run a command when the
   writer is searching for a phrase that matches a command name. The model
   does not take part in routing.
   - Failure mode: a writer who forgets the `/` sends "document list" to the
     model. That is harmless (the model can answer it with the same tool) and
     costs one model turn.
   - Failure mode: a request that starts with `/` (a path, say) is read as a
     command and reports an unknown command. The hint explains how to send it
     anyway (below).
2. **Arguments: none, or one simple one.** A command is offered in the bar
   only when it can be typed without JSON:
   - it takes no arguments (`/app status`, `/notes list`, `/document create`);
   - its only required argument is a string, filled from the rest of the line
     (`/notes search microscopic firework`, `/note open Iodine.md`); or
   - its only required argument is `tabId`, filled from the note the bar was
     opened over.
   Anything that needs more (revisions, targets, edit lists) is the model's job:
   the writer asks in plain words and the Assistant makes the tool call. A
   trailing JSON object still parses, for testing, but the bar does not
   advertise it.
3. **Requests go to the sidebar's current chat.** The bar opens the sidebar and
   sends the line as a message, exactly as if it had been typed there. It does
   not attach note text itself; the model reads notes through its read tools, as
   it does today.

## 4.1 — The bar

- [ ] Rework `CommandLineSwitchboard` into the bar: one input, Ctrl+` to open
  and close, Escape dismisses without side effects. Add a toolbar button that
  opens it.
- [ ] Capture the source tab (and its revision and selection) when the bar
  opens, so a later dispatch cannot be redirected to whichever tab has focus.
- [ ] A hint under the input: "`/` runs a command · anything else goes to the
  Language Model". Show which provider and chat a request will go to.
- [ ] Return focus to the source note when the bar closes.
- [ ] Accessible name, keyboard-only use, and a polite live region for results.

## 4.2 — Commands

- [ ] Parse `/name rest-of-line`: match the longest catalog name, then fill the
  single argument as in Decision 2. Unknown names and missing arguments report
  a readable error inline.
- [ ] Complete command names from the catalog as the writer types after `/`,
  with each command's one-line description. Only bar-eligible commands appear.
- [ ] Dispatch through `commands.dispatch` as the `user` caller.
- [ ] Show results as readable text, not JSON: a short summary per command
  (counts, names, the opened note), with the raw result behind a disclosure.
- [ ] Close the bar after commands that move the writer elsewhere (`note open`,
  `document create`), as the switchboard does today. `/note open` passes
  `focus: true`, since the writer asked to see the note.
- [ ] A command never opens the sidebar, including when it fails.

## 4.3 — Requests

- [ ] Send through the assistant workspace's `send`, opening the sidebar first.
  Clear the bar once the message is accepted.
- [ ] If the current chat is still answering, keep the text in the bar and say
  so; do not queue or interrupt.
- [ ] With the provider missing or signed out, say what is wrong in the bar and
  offer the sidebar's setup view; send nothing.
- [ ] A line that starts with `//` is sent as a request with one `/` removed,
  for requests that begin with a path.

## 4.4 — Existing surfaces

- [x] **RESOLVED** — Chat panes are dropped; the sidebar is the chat surface.
- [ ] Remove the switchboard's raw-JSON caption and example buttons once the bar
  replaces them. Update README's shortcut table and `docs/internal-commands.md`
  ("Human command entry").
- [ ] Keep selection actions, the Spread menu, writing review, speech, and
  formatting working alongside the bar.
- [ ] Decide the future of Phase 2's local open-note search portal (open
  decision below). Phase 3 asks the same question.

## Acceptance examples

- [ ] `/document create` opens a new note, and the sidebar does not open.
- [ ] `/notes search tide tables` lists matching notes inline.
- [ ] `/note open Iodine.md` opens that note in front and closes the bar.
- [ ] `/frobnicate` reports an unknown command and opens nothing.
- [ ] Typing `document list` (no slash) sends it to the Language Model.
- [ ] A request opens the sidebar and streams the reply in the current chat.
- [ ] A request while the chat is answering stays in the bar with a note.
- [ ] With the CLI signed out, a request explains the gap and sends nothing.
- [ ] A command dispatched after focus moved still targets the source tab.

## Open decisions

- Whether the bar replaces Phase 2's local open-note search portal, or the
  portal stays as a separate local-only tool.
