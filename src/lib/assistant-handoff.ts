// Hand-offs to the Language Model sidebar: a panel drafts a request, the writer sends it.
// Nothing reaches a model until they do (growth/phases/phase-3.md, section 2).

import type { AssistantWorkspace } from "./assistant-workspace";

/** Longest passage or result quoted into a draft, in characters. */
export const HANDOFF_QUOTE_LIMIT = 1500;

/** Markdown blockquote, trimmed to the limit. */
export function quote(text: string, limit = HANDOFF_QUOTE_LIMIT): string {
  const trimmed = text.trim();
  const body = trimmed.length > limit ? `${trimmed.slice(0, limit).trimEnd()}…` : trimmed;
  return body.split("\n").map(line => `> ${line}`).join("\n");
}

export function reviewDiscussionDraft(review: { noteName: string; passage: string; instruction?: string; output?: string }): string {
  const parts = [`About this passage from ${review.noteName}:`, quote(review.passage)];
  if (review.output?.trim()) {
    parts.push(review.instruction?.trim() ? `I asked for a review ("${review.instruction.trim()}") and got:` : "A review returned:", quote(review.output));
  }
  return `${parts.join("\n\n")}\n\n`;
}

export const noteSearchDraft = (query: string) => `Find "${query.trim()}" in my notes and open it with the phrase selected.`;
export const webSearchDraft = (query: string) => `Search the web for "${query.trim()}" and summarize what you find, with sources.`;

/**
 * Open the sidebar with a drafted request and put the cursor at its end. An existing draft is
 * kept: `keepExisting` leaves it alone, otherwise the new text follows it after a blank line.
 */
export function openAssistantWithDraft(assistant: Pick<AssistantWorkspace, "state" | "setDraft" | "setOpen">, text: string, options: { keepExisting?: boolean } = {}) {
  const current = assistant.state.draft.trim();
  if (!current) assistant.setDraft(text);
  else if (!options.keepExisting) assistant.setDraft(`${assistant.state.draft.trimEnd()}\n\n${text}`);
  assistant.setOpen(true);
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>(".assistant-sidebar [data-assistant-input]");
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
