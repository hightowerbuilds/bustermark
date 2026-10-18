import { invoke } from "@tauri-apps/api/core";
import { createSignal, onMount } from "solid-js";
import { webSearchConfigured } from "../lib/web-search";

export function WebSearchSettings() {
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal("Checking saved key…");
  onMount(() => {
    webSearchConfigured().then(saved => setStatus(saved ? "Brave key saved: web search uses Brave." : "No Brave key saved: web search uses DuckDuckGo."))
      .catch(error => setStatus(String(error)));
  });
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy() || !key().trim()) return;
    setBusy(true);
    try {
      await invoke("web_search_save_key", { apiKey: key().trim() });
      setKey(""); setStatus("Search key saved. Ask a chat to search the web to try it.");
    } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); }
  };
  return <section class="ai-settings-section" aria-label="Web search">
    <h3>Web search</h3>
    <p class="ai-settings-desc">Chat can search the web and cite source links without any setup: search terms go to DuckDuckGo, and picture searches fall back to Wikimedia Commons when DuckDuckGo refuses. Saving a Brave Search API key uses Brave for web search instead (an official API; Brave's charges and quotas apply).</p>
    <form class="ai-settings-row" onSubmit={save}>
      <label class="ai-settings-label" for="web-search-key">Brave Search API key</label>
      <input id="web-search-key" class="ai-input ai-input-key" type="password" autocomplete="off" spellcheck={false}
        value={key()} disabled={busy()} placeholder="Enter a key to save or replace"
        onInput={event => setKey(event.currentTarget.value)} />
      <button type="submit" class="ai-provider-btn" disabled={busy() || !key().trim()}>{busy() ? "Saving…" : "Save search key"}</button>
    </form>
    <p class="ai-settings-desc">Stored in your desktop keyring, separately from chat history. Linux requires an unlocked Secret Service.</p>
    <p role="status" class="ai-settings-desc">{status()}</p>
  </section>;
}
