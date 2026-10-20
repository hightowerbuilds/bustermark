import { Component, For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { cliName } from "../lib/assistant";
import { barCompletions, barUsage, parseBarLine, summarizeResult, type BarSummary } from "../lib/command-bar";
import type { CommandResult } from "../lib/feature-commands";

interface CommandBarProps {
  visible: boolean;
  /** The tab the bar was opened over, captured before focus moved into the bar. */
  sourceTabId: string | null;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenAi: () => void;
}

type Outcome =
  | { kind: "result"; summary: BarSummary; raw: CommandResult }
  | { kind: "message"; tone: "error" | "info"; text: string; setup?: boolean };

/** One line for both: `/` runs an app command here, anything else goes to the Language Model sidebar. */
const CommandBar: Component<CommandBarProps> = (props) => {
  const { commands, assistant } = useBuster();
  const [line, setLine] = createSignal("");
  const [outcome, setOutcome] = createSignal<Outcome | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const catalog = createMemo(() => props.visible ? commands.describe() : []);
  const suggestions = createMemo(() => barCompletions(line(), catalog()));
  const chatTitle = () => assistant.state.chats.find(chat => chat.id === assistant.state.activeId)?.title ?? "New chat";

  createEffect(on(() => props.visible, visible => {
    if (!visible) return;
    setOutcome(null);
    requestAnimationFrame(() => inputRef?.focus());
  }));
  createEffect(on(suggestions, () => setHighlight(0)));

  async function runCommand(command: string, args: Record<string, unknown>, closes: boolean, selectionOf?: string) {
    if (selectionOf) {
      // The note's selection as it is now; the bar has focus, but the editor keeps its selection.
      const read = await commands.dispatch({ requestId: crypto.randomUUID(), command: "selection read", args: { tabId: selectionOf } }, "user");
      if (!read.ok) { setOutcome({ kind: "result", summary: summarizeResult(read), raw: read }); return; }
      args = read.data as Record<string, unknown>;
    }
    const raw = await commands.dispatch({ requestId: crypto.randomUUID(), command, args }, "user");
    setOutcome({ kind: "result", summary: summarizeResult(raw), raw });
    if (raw.ok) setLine("");
    if (raw.ok && closes) props.onClose();
  }

  async function sendRequest(text: string) {
    const state = assistant.state;
    const name = cliName(state.provider);
    if (!state.ready || state.switching) {
      setOutcome({ kind: "message", tone: "info", text: "Your chats are still loading. Try again in a moment; your text stays here." });
      return;
    }
    if (state.running) {
      setOutcome({ kind: "message", tone: "info", text: `${name} is still answering in "${chatTitle()}". Your text stays here until it finishes.` });
      return;
    }
    if (state.connection === "missing" || state.connection === "logged-out") {
      setOutcome({ kind: "message", tone: "error", setup: true,
        text: `${state.connectionDetail || `${name} isn't ready.`} Nothing was sent.` });
      return;
    }
    assistant.setOpen(true);
    await assistant.send(text);
    setLine("");
    props.onClose();
  }

  async function submit() {
    if (busy()) return;
    const parsed = parseBarLine(line(), catalog(), props.sourceTabId);
    if (parsed.kind === "empty") return;
    if (parsed.kind === "invalid") {
      setOutcome({ kind: "message", tone: "error", text: parsed.message });
      return;
    }
    setBusy(true);
    try {
      if (parsed.kind === "command") await runCommand(parsed.command, parsed.args, parsed.closes, parsed.selectionOf);
      else await sendRequest(parsed.text);
    } catch (error) {
      setOutcome({ kind: "message", tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  function complete(index = highlight()) {
    const command = suggestions()[index];
    if (!command) return false;
    setLine(`/${command.name} `);
    inputRef?.focus();
    return true;
  }

  function onKeyDown(e: KeyboardEvent) {
    const count = suggestions().length;
    if (e.key === "Escape") { e.preventDefault(); props.onClose(); return; }
    if (!count) return;
    // Only while completing a command name: once a full name and a space are typed, Enter runs it.
    const typed = line().trimStart().slice(1).toLowerCase();
    const completing = !suggestions().some(command => typed.startsWith(`${command.name} `));
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(i => (i + 1) % count); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(i => (i - 1 + count) % count); }
    else if (e.key === "Tab" && !e.shiftKey && completing) { e.preventDefault(); complete(); }
  }

  const status = () => {
    if (busy()) return "Working";
    const current = outcome();
    if (!current) return "Ready";
    return current.kind === "result" ? (current.summary.ok ? "Command completed" : "Command failed") : current.text;
  };

  return (
    <Show when={props.visible}>
      <div class="command-line-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) props.onClose(); }}>
        <div class="command-line-shell" role="dialog" aria-label="Command bar">
          <form class="command-line-bar" onSubmit={e => { e.preventDefault(); void submit(); }}>
            <span class="command-line-prompt" aria-hidden="true">&gt;</span>
            <input ref={inputRef} class="command-line-input" value={line()}
              onInput={e => { setLine(e.currentTarget.value); setOutcome(null); }}
              onKeyDown={onKeyDown}
              autocomplete="off" autocapitalize="off" spellcheck={false}
              aria-label="Command or request" aria-describedby="command-bar-hint"
              aria-autocomplete="list" aria-controls="command-bar-suggestions"
              aria-activedescendant={suggestions().length ? `command-bar-suggestion-${highlight()}` : undefined}
              placeholder="Ask the Language Model, or type / for a command" />
            <button type="submit" disabled={busy() || !line().trim()}>{busy() ? "Working…" : line().trimStart().startsWith("/") && !line().trimStart().startsWith("//") ? "Run" : "Send"}</button>
          </form>
          <div id="command-bar-hint" class="command-line-caption">
            <kbd>/</kbd> runs a command · anything else goes to {cliName(assistant.state.provider)} in "{chatTitle()}" · Esc closes
          </div>
          <Show when={suggestions().length}>
            <ul id="command-bar-suggestions" class="command-bar-suggestions" role="listbox" aria-label="Commands">
              <For each={suggestions()}>{(command, i) =>
                <li id={`command-bar-suggestion-${i()}`} role="option" aria-selected={i() === highlight()}
                  classList={{ "is-highlighted": i() === highlight() }}
                  onMouseDown={e => { e.preventDefault(); complete(i()); }}>
                  <span class="command-bar-usage">{barUsage(command)}</span>
                  <span class="command-bar-description">{command.description}</span>
                </li>}
              </For>
            </ul>
          </Show>
          <Show when={outcome()}>{current => {
            const value = current();
            return value.kind === "result"
              ? <div class="command-bar-result" classList={{ "is-error": !value.summary.ok }}>
                  <p class="command-bar-result-title">{value.summary.title}</p>
                  <Show when={value.summary.lines.length}>
                    <ul class="command-bar-result-lines"><For each={value.summary.lines}>{text => <li>{text}</li>}</For></ul>
                  </Show>
                  <details class="command-bar-raw">
                    <summary>Raw result</summary>
                    <pre class="command-line-result" tabindex={0} aria-label="Raw command result">{JSON.stringify(value.raw, null, 2)}</pre>
                  </details>
                </div>
              : <div class="command-bar-result" classList={{ "is-error": value.tone === "error" }}>
                  <p class="command-bar-result-title">{value.text}</p>
                  <Show when={value.setup}>
                    <button type="button" onClick={() => { assistant.setOpen(true); void assistant.refreshStatus(); props.onClose(); }}>Open setup</button>
                  </Show>
                </div>;
          }}</Show>
          <div class="visually-hidden" role="status" aria-live="polite">{status()}</div>
          <div class="command-line-options" role="group" aria-label="Open a tool">
            <button type="button" class="command-line-option" onClick={props.onOpenAi}>AI settings</button>
            <button type="button" class="command-line-option" onClick={props.onOpenSettings}>Settings</button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default CommandBar;
