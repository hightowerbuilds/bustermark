// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { noteSearchDraft, openAssistantWithDraft, quote, reviewDiscussionDraft, webSearchDraft } from "./assistant-handoff";

function assistant(draft = "") {
  const state = { draft };
  return { state, setDraft: vi.fn((text: string) => { state.draft = text; }), setOpen: vi.fn() } as any;
}

describe("hand-offs to the Language Model", () => {
  it("quotes passages as Markdown and trims long ones", () => {
    expect(quote("one\ntwo")).toBe("> one\n> two");
    expect(quote("x".repeat(20), 8)).toBe("> xxxxxxxx…");
  });

  it("drafts a discussion of a passage, with the review result when there is one", () => {
    expect(reviewDiscussionDraft({ noteName: "Tin.md", passage: "The lamp swung." }))
      .toBe("About this passage from Tin.md:\n\n> The lamp swung.\n\n");
    expect(reviewDiscussionDraft({ noteName: "Tin.md", passage: "The lamp swung.", instruction: "Rewrite clearly.", output: "The lamp swayed." }))
      .toBe('About this passage from Tin.md:\n\n> The lamp swung.\n\nI asked for a review ("Rewrite clearly.") and got:\n\n> The lamp swayed.\n\n');
  });

  it("drafts note and web searches from the query", () => {
    expect(noteSearchDraft("  harbor lamp ")).toBe('Find "harbor lamp" in my notes and open it with the phrase selected.');
    expect(webSearchDraft("tide tables")).toBe('Search the web for "tide tables" and summarize what you find, with sources.');
  });

  it("opens the sidebar with the draft and focuses the composer at its end", async () => {
    document.body.innerHTML = '<div class="assistant-sidebar"><textarea data-assistant-input></textarea></div>';
    const a = assistant();
    openAssistantWithDraft(a, "Find it.");
    expect(a.setDraft).toHaveBeenCalledWith("Find it.");
    expect(a.setOpen).toHaveBeenCalledWith(true);
    const input = document.querySelector("textarea")!;
    input.value = a.state.draft;
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe("Find it.".length);
  });

  it("adds to an existing draft, or keeps it alone when asked", () => {
    const a = assistant("Half a question");
    openAssistantWithDraft(a, "Find it.");
    expect(a.state.draft).toBe("Half a question\n\nFind it.");
    const b = assistant("Half a question");
    openAssistantWithDraft(b, "Make me a color scheme: ", { keepExisting: true });
    expect(b.setDraft).not.toHaveBeenCalled();
    expect(b.setOpen).toHaveBeenCalledWith(true);
  });
});
