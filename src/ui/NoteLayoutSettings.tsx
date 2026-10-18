import { For, Show, createSignal } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { DEFAULT_WRITING_APPEARANCE } from "../lib/writing-appearance";

/**
 * Settings › Writing › Note layout: which layouts differ from the defaults (changed by the
 * Language Model or the command line), each with Reset through the shared `appearance reset`.
 */
export default function NoteLayoutSettings() {
  const { appearance, commands, store } = useBuster();
  const [error, setError] = createSignal("");
  const state = appearance.state;
  const customDefaults = () => Object.entries(DEFAULT_WRITING_APPEARANCE).some(([key, value]) => state.app[key as keyof typeof state.app] !== value);
  const folder = () => { const id = appearance.workspaceId(); return id && Object.keys(state.workspaces[id] ?? {}).length ? id : null; };
  const notes = () => Object.entries(state.tabs).filter(([, patch]) => Object.keys(patch).length)
    .map(([tabId]) => ({ tabId, name: store.tabs.find(tab => tab.id === tabId)?.name ?? "A closed note" }));

  async function reset(target: { scope: "app" | "workspace" | "tab"; tabId?: string; workspaceId?: string }) {
    setError("");
    const result = await commands.dispatch({ requestId: crypto.randomUUID(), command: "appearance reset", args: { ...target, revision: state.revision } }, "user");
    if (!result.ok) setError(result.error.message);
  }

  return (
    <div class="settings-row-content settings-note-layout">
      <div class="settings-info">
        <span class="settings-label">Note layout</span>
        <span class="settings-desc">Column width, centering, and line spacing the Language Model or the command line changed</span>
      </div>
      <ul class="settings-note-layout-list">
        <Show when={customDefaults()}>
          <li><span>Every note: changed defaults</span><button type="button" class="settings-theme-btn" onClick={() => void reset({ scope: "app" })}>Reset defaults</button></li>
        </Show>
        <Show when={folder()}>{id =>
          <li><span>This folder: its own layout</span><button type="button" class="settings-theme-btn" onClick={() => void reset({ scope: "workspace", workspaceId: id() })}>Reset</button></li>
        }</Show>
        <For each={notes()}>{note =>
          <li><span>{note.name}: its own layout</span>
            <button type="button" class="settings-theme-btn" aria-label={`Reset the layout of ${note.name}`} onClick={() => void reset({ scope: "tab", tabId: note.tabId })}>Reset</button></li>
        }</For>
        <Show when={!customDefaults() && !folder() && !notes().length}><li class="settings-desc">Every note uses the default layout.</li></Show>
      </ul>
      <Show when={error()}><p class="bg-error" role="alert">{error()}</p></Show>
    </div>
  );
}
