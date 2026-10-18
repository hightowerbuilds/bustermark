import { Show, createSignal } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { layoutRevision } from "../lib/appearance-approval";

/**
 * Undo for a layout change the Assistant made, shown under its row in the chat. It reverts
 * through the shared `appearance revert` command, and only while that change is still the
 * latest one: any later layout change disables it.
 */
export default function LayoutUndo(props: { result: string | undefined }) {
  const { appearance, commands } = useBuster();
  const [undone, setUndone] = createSignal(false);
  const [error, setError] = createSignal("");
  const revision = () => layoutRevision(props.result);
  const available = () => !undone() && revision() !== null && appearance.state.revision === revision() && appearance.state.historyLength > 0;

  async function undo() {
    setError("");
    const result = await commands.dispatch({ requestId: crypto.randomUUID(), command: "appearance revert", args: { revision: revision() } }, "user");
    if (result.ok) setUndone(true);
    else setError(result.error.message);
  }

  return <div class="as-layout-undo">
    <Show when={!undone()} fallback={<span class="as-layout-undone">Undone</span>}>
      <button type="button" class="as-button" disabled={!available()} onClick={() => void undo()}
        title={available() ? "Restore the layout from before this change" : "The layout has changed since; undo is no longer available here"}>Undo</button>
    </Show>
    <Show when={error()}><span class="as-layout-error" role="alert">{error()}</span></Show>
  </div>;
}
