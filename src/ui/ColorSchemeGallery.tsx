import { For, Show, createSignal } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { SCHEME_COLOR_KEYS, type ColorScheme } from "../lib/color-schemes";
import type { AppSettings } from "../lib/ipc";
import { openAssistantWithDraft } from "../lib/assistant-handoff";
import GalleryCard from "./GalleryCard";
import "../styles/backgrounds.css";
import "../styles/color-schemes.css";

export const DESCRIBE_SCHEME_DRAFT = "Make me a color scheme: ";

/** Settings → Appearances: color schemes the Language Model made, below Dark, Light, and Custom. */
export default function ColorSchemeGallery(props: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const { colorSchemes, assistant } = useBuster();
  const state = colorSchemes.state;
  const [error, setError] = createSignal("");
  const [confirming, setConfirming] = createSignal<string | null>(null);
  const shown = () => (props.settings.theme_mode === "scheme" ? props.settings.theme_scheme_id : "");

  async function run(action: () => Promise<unknown>) {
    setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function remove(id: string) {
    await colorSchemes.remove(id);
    // The scheme on screen is gone: show Dark rather than a scheme that no longer exists.
    if (shown() === id) props.onChange({ ...props.settings, theme_mode: "dark", theme_hue: -1, theme_scheme_id: "" });
  }

  const describe = () => openAssistantWithDraft(assistant, DESCRIBE_SCHEME_DRAFT, { keepExisting: true });

  const Card = (cardProps: { item: ColorScheme }) => {
    const colors = () => cardProps.item.colors;
    return (
      <GalleryCard noun="Color scheme" name={cardProps.item.name} prompt={cardProps.item.prompt} selected={shown() === cardProps.item.id}
        thumb={<span class="bg-thumb scheme-thumb" style={{ background: colors().background, color: colors().text }}>
          <span class="scheme-thumb-text">Aa <span style={{ color: colors().accent }}>Aa</span> <span style={{ background: colors().selection }}>Aa</span></span>
          <span class="scheme-preview-swatches">
            <For each={SCHEME_COLOR_KEYS}>{key => <span class="scheme-preview-swatch" style={{ background: colors()[key] }} />}</For>
          </span>
        </span>}
        confirming={confirming() === cardProps.item.id} onConfirming={open => setConfirming(open ? cardProps.item.id : null)}
        onPick={() => props.onChange({ ...props.settings, theme_mode: "scheme", theme_scheme_id: cardProps.item.id })}
        onRename={name => colorSchemes.rename(cardProps.item.id, name)}
        onDelete={() => void run(() => remove(cardProps.item.id))}
        onError={setError} />
    );
  };

  return (
    <div class="scheme-gallery">
      <Show when={state.items.length > 0}>
        <div class="bg-grid" role="radiogroup" aria-label="Saved color schemes">
          <For each={state.items}>{item => <Card item={item} />}</For>
        </div>
      </Show>
      <div class="scheme-gallery-describe">
        <button type="button" class="settings-theme-btn" onClick={describe}>Describe a scheme…</button>
        <Show when={state.loaded && !state.items.length}>
          <span class="settings-desc">The Language Model makes a scheme from your words, such as "warm sepia for late nights".</span>
        </Show>
      </div>
      <Show when={error() || state.error}><p class="bg-error" role="alert">{error() || state.error}</p></Show>
    </div>
  );
}
