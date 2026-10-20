// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { createStore } from "solid-js/store";
import { createWorkbenchCommands } from "../lib/workbench-commands";

const mock = vi.hoisted(() => ({ setOpen: vi.fn(), send: vi.fn(async (_text: string) => {}), refreshStatus: vi.fn(async () => {}) }));
const [assistantState, setAssistantState] = createStore({
  ready: true, switching: false, running: false, connection: "ready", connectionDetail: "", provider: "claude",
  activeId: "c1", chats: [{ id: "c1", title: "Tide notes" }],
});
const service = createWorkbenchCommands({
  tabs: () => [{ id: "file_7", name: "Iodine.md", path: "/n/Iodine.md", dirty: false, type: "file" }],
  activeTabId: () => "file_7", workspaceRoot: () => "/n",
  document: () => ({ text: "the tide tables", revision: 3, dirty: false }), focusTab: () => {}, createNote: () => "file_8",
});
const dispatch = vi.spyOn(service, "dispatch");
vi.mock("../lib/buster-context", () => ({ useBuster: () => ({
  commands: service,
  assistant: { state: assistantState, setOpen: mock.setOpen, send: mock.send, refreshStatus: mock.refreshStatus },
}) }));
const { default: CommandBar } = await import("./CommandBar");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); document.body.replaceChildren(); vi.clearAllMocks();
  setAssistantState({ running: false, connection: "ready", connectionDetail: "" });
});

function mount(sourceTabId: string | null = "file_7") {
  const onClose = vi.fn();
  const root = document.createElement("div"); document.body.append(root);
  dispose = render(() => createComponent(CommandBar, { visible: true, sourceTabId, onClose, onOpenSettings: () => {}, onOpenAi: () => {} }), root);
  const input = root.querySelector<HTMLInputElement>("input")!;
  const type = (text: string) => { input.value = text; input.dispatchEvent(new InputEvent("input", { bubbles: true })); };
  const submit = async (text: string) => {
    type(text);
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector("button[type=submit]")!.textContent).not.toBe("Working…"));
  };
  return { root, input, type, submit, onClose, text: () => root.textContent ?? "" };
}

describe("command bar", () => {
  it("runs a typed command inline without opening the Language Model", async () => {
    const bar = mount();
    await bar.submit("/document create");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ command: "document create", args: {} }), "user");
    expect(bar.onClose).toHaveBeenCalledOnce();
    expect(mock.setOpen).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("shows a readable result and keeps the bar open for commands that stay put", async () => {
    const bar = mount();
    await bar.submit("/app status");
    expect(bar.text()).toContain("tabCount: 1");
    expect(bar.root.querySelector("details summary")!.textContent).toBe("Raw result");
    expect(bar.onClose).not.toHaveBeenCalled();
    expect(bar.input.value).toBe("");
  });

  it("targets the tab the bar was opened over", async () => {
    const bar = mount("file_7");
    await bar.submit("/document read");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ command: "document read", args: { tabId: "file_7" } }), "user");
  });

  it("reports an unknown command and opens nothing", async () => {
    const bar = mount();
    await bar.submit("/frobnicate");
    expect(bar.text()).toContain("There is no /frobnicate command.");
    expect(dispatch).not.toHaveBeenCalled();
    expect(mock.setOpen).not.toHaveBeenCalled();
    expect(bar.input.value).toBe("/frobnicate");
  });

  it("sends anything else to the current chat and closes", async () => {
    const bar = mount();
    expect(bar.text()).toContain('anything else goes to Claude Code in "Tide notes"');
    await bar.submit("document list");
    expect(mock.setOpen).toHaveBeenCalledWith(true);
    expect(mock.send).toHaveBeenCalledWith("document list");
    expect(dispatch).not.toHaveBeenCalled();
    expect(bar.onClose).toHaveBeenCalledOnce();
  });

  it("keeps a request in the bar while the chat is still answering", async () => {
    setAssistantState("running", true);
    const bar = mount();
    await bar.submit("and the third one?");
    expect(mock.send).not.toHaveBeenCalled();
    expect(bar.text()).toContain('Claude Code is still answering in "Tide notes"');
    expect(bar.input.value).toBe("and the third one?");
    expect(bar.onClose).not.toHaveBeenCalled();
  });

  it("explains a signed-out CLI, sends nothing, and offers setup", async () => {
    setAssistantState({ connection: "logged-out", connectionDetail: "Claude Code is not signed in." });
    const bar = mount();
    await bar.submit("tighten this");
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.setOpen).not.toHaveBeenCalled();
    expect(bar.text()).toContain("Claude Code is not signed in. Nothing was sent.");
    [...bar.root.querySelectorAll("button")].find(b => b.textContent === "Open setup")!.click();
    expect(mock.setOpen).toHaveBeenCalledWith(true);
    expect(mock.refreshStatus).toHaveBeenCalledOnce();
  });

  it("completes a command name with Tab and lists only commands the bar can run", () => {
    const bar = mount();
    bar.type("/document");
    const options = [...bar.root.querySelectorAll("[role=option]")].map(li => li.querySelector(".command-bar-usage")!.textContent);
    expect(options).toEqual(["/document create", "/document list", "/document read"]);
    bar.input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    bar.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(bar.input.value).toBe("/document list ");
  });
});
