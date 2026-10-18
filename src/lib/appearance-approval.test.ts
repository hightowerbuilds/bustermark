import { describe, expect, it } from "vitest";
import { describeLayoutApproval, layoutRevision } from "./appearance-approval";

const names = (id: string) => (id === "file_1" ? "Mercury.md" : undefined);

describe("layout approval cards", () => {
  it("names the note and lists each change in plain words", () => {
    expect(describeLayoutApproval("appearance apply", { scope: "tab", tabId: "file_1", revision: 3,
      changes: { alignment: "center", columnWidth: 760, lineHeight: 1.8, fontSize: 0, background: "paper", paddingTop: 40 } }, names)).toEqual({
      title: "Change the layout of Mercury.md?",
      changes: ["Centered column", "760 px column", "Line spacing 1.8", "Text size from Settings", "Paper page", "Top margin 40 px"],
    });
  });

  it("says when a change reaches every note", () => {
    expect(describeLayoutApproval("appearance apply", { scope: "app", revision: 0, changes: { columnWidth: 0 } }, names))
      .toEqual({ title: "Change the layout of every note?", changes: ["Column fills the tab"] });
    expect(describeLayoutApproval("appearance reset", { scope: "app", revision: 0 }, names)?.title).toBe("Reset the default layout for every note?");
  });

  it("words presets, resets and revert", () => {
    expect(describeLayoutApproval("appearance presets apply", { scope: "tab", tabId: "file_1", revision: 0, name: "Reading room" }, names)?.title)
      .toBe("Use Reading room for Mercury.md?");
    expect(describeLayoutApproval("appearance reset", { scope: "tab", tabId: "file_9", revision: 0 }, names)?.title)
      .toBe("Reset the layout of this note to the defaults?");
    expect(describeLayoutApproval("appearance revert", { revision: 4 }, names)).toEqual({ title: "Undo the last layout change?", changes: [] });
    expect(describeLayoutApproval("document edit", {}, names)).toBeNull();
  });

  it("reads the revision a change produced from its tool result", () => {
    expect(layoutRevision(JSON.stringify({ revision: 5, scope: "tab" }))).toBe(5);
    expect(layoutRevision("not json")).toBeNull();
    expect(layoutRevision(JSON.stringify({ revision: "5" }))).toBeNull();
    expect(layoutRevision(undefined)).toBeNull();
  });
});
