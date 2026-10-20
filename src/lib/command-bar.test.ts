import { describe, expect, it } from "vitest";
import { createEditorEngine } from "../editor/engine";
import { barArgument, barCompletions, parseBarLine, summarizeResult } from "./command-bar";
import { registerDocumentEditCommands } from "./document-edit";
import { registerNoteCommands } from "./note-commands";
import type { Tab } from "./tab-types";
import { createWorkbenchCommands } from "./workbench-commands";

const ROOT = "/home/writer/Notes";

/** The real workbench, note and document-edit commands over a small Notes folder. */
function fixture() {
  const disk = new Map([[`${ROOT}/Iodine.md`, "the tide tables\nok it could be"], [`${ROOT}/Tin.md`, "no tides here"]]);
  const tabs: Tab[] = [{ id: "file_1", name: "Iodine.md", path: `${ROOT}/Iodine.md`, dirty: false, type: "file" }];
  const engine = createEditorEngine(disk.get(`${ROOT}/Iodine.md`)!);
  const service = createWorkbenchCommands({
    tabs: () => tabs, activeTabId: () => "file_1", workspaceRoot: () => ROOT,
    document: id => id === "file_1" ? { text: engine.getText(), revision: engine.editSeq(), dirty: false } : null,
    focusTab: () => {}, createNote: () => "file_2",
  });
  registerNoteCommands(service, {
    notesRoot: () => ROOT, tabs: () => tabs, engine: id => id === "file_1" ? engine : undefined,
    listFiles: async root => [...disk.keys()].map(p => ({ relative_path: p.slice(root.length + 1), name: p.split("/").pop()! })),
    searchFiles: async (root, query) => [...disk.entries()].flatMap(([p, text]) => text.split("\n").flatMap((line, i) =>
      line.toLowerCase().includes(query.toLowerCase()) ? [{ relative_path: p.slice(root.length + 1), line_number: i + 1, line_content: line }] : [])),
    readFile: async path => ({ content: disk.get(path) ?? "" }),
    createFile: async () => {}, writeFile: async () => {}, renameFile: async path => path,
    openFile: async path => tabs.find(tab => tab.path === path)?.id ?? "file_9",
  });
  registerDocumentEditCommands(service, { hasTab: id => id === "file_1", engine: id => id === "file_1" ? engine : undefined });
  return { service, catalog: service.describe() };
}

describe("command bar routing", () => {
  const { catalog } = fixture();
  const parse = (line: string, source: string | null = "file_1") => parseBarLine(line, catalog, source);

  it("sends anything without a leading slash to the Language Model, even a command's name", () => {
    expect(parse("tighten the second paragraph")).toEqual({ kind: "request", text: "tighten the second paragraph" });
    expect(parse("  document list ")).toEqual({ kind: "request", text: "document list" });
    expect(parse("   ")).toEqual({ kind: "empty" });
  });

  it("sends a line that starts with // as a request with one slash removed", () => {
    expect(parse("//Users/writer/Notes is where my notes live")).toEqual({ kind: "request", text: "/Users/writer/Notes is where my notes live" });
  });

  it("runs commands that take nothing, one string, or the source tab", () => {
    expect(parse("/app status")).toEqual({ kind: "command", command: "app status", args: {}, closes: false });
    expect(parse("/notes   search  tide tables")).toEqual({ kind: "command", command: "notes search", args: { query: "tide tables" }, closes: false });
    expect(parse("/document read")).toEqual({ kind: "command", command: "document read", args: { tabId: "file_1" }, closes: false });
    expect(parse("/Document Create")).toMatchObject({ kind: "command", command: "document create", closes: true });
    expect(parse("/help")).toMatchObject({ kind: "command", command: "commands list" });
    expect(parse("/commands describe note open")).toMatchObject({ args: { name: "note open" } });
  });

  it("brings an opened note to the front and closes the bar", () => {
    expect(parse("/note open Drafts/idea.md")).toEqual({ kind: "command", command: "note open", args: { path: "Drafts/idea.md", focus: true }, closes: true });
  });

  it("explains unknown commands, missing or extra arguments, and commands that need the Language Model", () => {
    expect(parse("/frobnicate now")).toEqual({ kind: "invalid", message: "There is no /frobnicate command. Type / to see the commands." });
    expect(parse("/")).toMatchObject({ kind: "invalid" });
    expect(parse("/notes search")).toMatchObject({ kind: "invalid", message: "/notes search <query> needs a query." });
    expect(parse("/app status please")).toMatchObject({ kind: "invalid", message: "/app status takes nothing after its name." });
    expect(parse("/document read Iodine.md")).toMatchObject({ kind: "invalid", message: expect.stringContaining("works on the current note") });
    expect(parse("/document read", null)).toMatchObject({ kind: "invalid", message: expect.stringContaining("Open one first") });
    expect(parse("/document edit")).toMatchObject({ kind: "invalid", command: "document edit", message: expect.stringContaining("Ask the Language Model") });
  });

  it("still reads a JSON object after the name, unadvertised", () => {
    expect(parse('/notes search {"query":"tide"}')).toMatchObject({ kind: "command", args: { query: "tide" } });
    expect(parse("/notes search {nope")).toMatchObject({ kind: "invalid", message: "That JSON object could not be read." });
  });

  it("classifies argument shapes by their required fields", () => {
    expect(barArgument({ type: "object", properties: {}, required: [] })).toEqual({ kind: "none" });
    expect(barArgument({ type: "object", properties: { tabId: { type: "string" } }, required: ["tabId"] })).toEqual({ kind: "tab" });
    expect(barArgument({ type: "object", properties: { query: { type: "string" } }, required: ["query"] })).toEqual({ kind: "text", name: "query" });
    expect(barArgument({ type: "object", properties: { revision: { type: "number" } }, required: ["revision"] })).toBeNull();
    expect(barArgument({ type: "object", properties: { tabId: { type: "string" }, revision: { type: "number" } }, required: ["tabId", "revision"] })).toBeNull();
  });
});

describe("command bar completion", () => {
  const { catalog } = fixture();

  it("lists only commands the bar can run, matching what follows the slash", () => {
    const names = (line: string) => barCompletions(line, catalog).map(command => command.name);
    // note rename needs a path and a new name, so it is the Language Model's to run.
    expect(names("/note")).toEqual(["note create", "note open", "note read", "notes list", "notes search"]);
    expect(names("/document")).toContain("document read");
    expect(names("/document")).not.toContain("document edit");
    expect(names("/notes search tide")).toEqual(["notes search"]);
    expect(names("notes")).toEqual([]);
    expect(names("//notes")).toEqual([]);
  });
});

describe("command bar results", () => {
  it("summarizes a phrase search with each note's first match", async () => {
    const { service, catalog } = fixture();
    const parsed = parseBarLine("/notes search tide", catalog, "file_1");
    if (parsed.kind !== "command") throw new Error("expected a command");
    const result = await service.dispatch({ requestId: "bar-1", command: parsed.command, args: parsed.args }, "user");
    expect(summarizeResult(result)).toEqual({ ok: true, title: '2 notes contain "tide".', lines: [
      "Iodine.md · line 1: the tide tables", "Tin.md · line 1: no tides here",
    ] });
    const one = await service.dispatch({ requestId: "bar-1b", command: "notes search", args: { query: "tables" } }, "user");
    expect(summarizeResult(one).title).toBe('1 note contains "tables".');
  });

  it("reports failures by message and code", async () => {
    const { service } = fixture();
    const result = await service.dispatch({ requestId: "bar-2", command: "note open", args: { path: "../x.md", focus: true } }, "user");
    expect(summarizeResult(result)).toEqual({ ok: false, title: expect.stringContaining("relative to the Notes folder"), lines: ["INVALID_ARGUMENTS"] });
  });

  it("falls back to fields and short lists for other commands", async () => {
    const { service } = fixture();
    const status = await service.dispatch({ requestId: "bar-3", command: "app status", args: {} }, "user");
    expect(summarizeResult(status)).toEqual({ ok: true, title: "Done.", lines: ["product: BusterMark", `workspaceRoot: ${ROOT}`, "activeTabId: file_1", "tabCount: 1"] });
    const documents = await service.dispatch({ requestId: "bar-4", command: "document list", args: {} }, "user");
    expect(summarizeResult(documents).lines).toEqual(["documents: 1", `  ${ROOT}/Iodine.md`]);
  });

  it("lists the bar's own commands for /help", async () => {
    const { service } = fixture();
    const summary = summarizeResult(await service.dispatch({ requestId: "bar-5", command: "commands list", args: {} }, "user"));
    expect(summary.title).toMatch(/^\d+ commands can be typed here/);
    expect(summary.lines.join("\n")).toContain("/notes search <query>");
    expect(summary.lines.join("\n")).not.toContain("document edit");
  });
});
