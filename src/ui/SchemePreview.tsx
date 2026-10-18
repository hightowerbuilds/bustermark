import { For, Show, createMemo } from "solid-js";
import { SCHEME_COLOR_KEYS, parseSchemeColors } from "../lib/color-schemes";
import "../styles/color-schemes.css";

/** A small page drawn in a proposed scheme: heading, a selected phrase, a card, and the eight swatches. */
export default function SchemePreview(props: { colors: unknown }) {
  const parsed = createMemo(() => {
    try { return { colors: parseSchemeColors(props.colors), error: "" }; }
    catch (e) { return { colors: undefined, error: e instanceof Error ? e.message : String(e) }; }
  });
  return <Show when={parsed().colors} fallback={<p class="bg-error" role="alert">{parsed().error}</p>}>{c =>
    <div class="scheme-preview" style={{ background: c().background, color: c().text }} role="img" aria-label="Color scheme preview">
      <div class="scheme-preview-heading" style={{ color: c().accent }}>Chapter One</div>
      <p class="scheme-preview-text">
        The kettle ticked as it cooled. <span style={{ background: c().selection }}>A line worth keeping</span> sat in the middle of the page.
      </p>
      <div class="scheme-preview-card" style={{ background: c().surface }}>
        <span style={{ color: c().textDim }}>Draft · 1,204 words</span>
        <span style={{ color: c().textMuted }}>Last edited this morning</span>
      </div>
      <div class="scheme-preview-swatches">
        <For each={SCHEME_COLOR_KEYS}>{key =>
          <span class="scheme-preview-swatch" style={{ background: c()[key] }} title={`${key} ${c()[key]}`} />
        }</For>
      </div>
    </div>
  }</Show>;
}
