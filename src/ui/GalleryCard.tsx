import { Show, createSignal, type JSX } from "solid-js";

/** One card in an Appearances gallery: pick it, rename it, or delete it after a confirmation. */
export default function GalleryCard(props: {
  noun: string;
  name: string;
  prompt: string;
  selected: boolean;
  thumb: JSX.Element;
  confirming: boolean;
  onConfirming: (confirming: boolean) => void;
  onPick: () => void;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  const [renaming, setRenaming] = createSignal(false);
  const [name, setName] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  let renameButton!: HTMLButtonElement;
  const closeRename = () => { setRenaming(false); renameButton?.focus(); };
  const saveName = async () => {
    if (saving()) return;
    setSaving(true); props.onError("");
    try { await props.onRename(name()); closeRename(); }
    catch (e) { props.onError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return (
    <div class="bg-card" classList={{ "bg-card-selected": props.selected }}>
      <button type="button" role="radio" aria-checked={props.selected} class="bg-card-pick"
        title={props.prompt || props.name} onClick={() => props.onPick()}>
        {props.thumb}
        <span class="bg-card-name">{props.name}</span>
        <Show when={props.prompt}><span class="bg-card-prompt">{props.prompt}</span></Show>
      </button>
      <button ref={renameButton} type="button" class="bg-card-rename" aria-label={`Rename ${props.name}`}
        onClick={() => { setName(props.name); setRenaming(true); }}>Rename</button>
      <Show when={renaming()}>
        <form class="bg-card-rename-form" onSubmit={e => { e.preventDefault(); void saveName(); }}
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!saving()) closeRename(); } }}>
          <input aria-label={`${props.noun} name`} value={name()} required disabled={saving()}
            ref={el => queueMicrotask(() => { el.focus(); el.select(); })}
            onInput={e => setName(e.currentTarget.value)} />
          <button type="submit" disabled={saving() || !name().trim()}>{saving() ? "Saving…" : "Save"}</button>
          <button type="button" disabled={saving()} onClick={closeRename}>Cancel</button>
        </form>
      </Show>
      <Show when={props.confirming} fallback={
        <button type="button" class="bg-card-delete" aria-label={`Delete ${props.name}`} title="Delete" onClick={() => props.onConfirming(true)}>×</button>
      }>
        <div class="bg-card-confirm" role="group" aria-label={`Delete ${props.name}?`}>
          <span>Delete?</span>
          <button type="button" onClick={() => { props.onConfirming(false); props.onDelete(); }}>Delete</button>
          <button type="button" onClick={() => props.onConfirming(false)}>Keep</button>
        </div>
      </Show>
    </div>
  );
}
