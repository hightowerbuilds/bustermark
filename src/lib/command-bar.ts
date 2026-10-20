// The command bar (growth/phases/phase-4.md): a leading "/" runs an app command, anything else is a
// request for the Language Model. Routing is by that rule alone; no model takes part.

import type { CommandResult, CommandSchema, FeatureCommands } from "./feature-commands";
import { snapshotSchema } from "./selection-commands";

export type CommandDescription = ReturnType<FeatureCommands["describe"]>[number];

/**
 * What a bar command takes: nothing, one string from the rest of the line, the source tab, or the
 * source note's current selection (read with `selection read` when the command runs).
 */
export type BarArgument = { kind: "none" } | { kind: "text"; name: string } | { kind: "tab" } | { kind: "selection" };

export type BarLine =
  | { kind: "empty" }
  | { kind: "request"; text: string }
  /** `selectionOf`: read this tab's selection and send it as the arguments. */
  | { kind: "command"; command: string; args: Record<string, unknown>; closes: boolean; selectionOf?: string }
  | { kind: "invalid"; command?: string; message: string };

/** Commands that move the writer to another note, so the bar closes after them. */
const CLOSES_BAR = new Set(["note open", "document create", "selection ai", "selection lookup", "selection voice"]);
const SELECTION_TARGET = JSON.stringify(snapshotSchema);
const ALIASES: Record<string, string> = { help: "commands list" };

/** Decision 2: a command can be typed in the bar only if it needs no JSON. */
export function barArgument(schema: CommandSchema): BarArgument | null {
  if (schema.type !== "object") return null;
  if (JSON.stringify(schema) === SELECTION_TARGET) return { kind: "selection" };
  const required = schema.required ?? [];
  if (required.length === 0) return { kind: "none" };
  if (required.length !== 1 || schema.properties?.[required[0]]?.type !== "string") return null;
  return required[0] === "tabId" ? { kind: "tab" } : { kind: "text", name: required[0] };
}

const describedArgument = (command: CommandDescription) => barArgument(command.inputSchema as CommandSchema);

/** `/notes search <query>`, `/app status`. */
export function barUsage(command: CommandDescription): string {
  const argument = describedArgument(command);
  return argument?.kind === "text" ? `/${command.name} <${argument.name}>` : `/${command.name}`;
}

/** Bar-ready commands whose names fit what follows the slash, for completion. */
export function barCompletions(line: string, catalog: CommandDescription[], limit = 8): CommandDescription[] {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return [];
  const typed = trimmed.slice(1).replace(/\s+/g, " ").toLowerCase();
  return catalog
    .filter(command => command.available && describedArgument(command)
      && (command.name.startsWith(typed) || typed.startsWith(`${command.name} `)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Read one line typed into the bar. `sourceTabId` is the tab the bar was opened over. */
export function parseBarLine(line: string, catalog: CommandDescription[], sourceTabId: string | null): BarLine {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "empty" };
  // "//" sends a request that itself starts with a slash, such as a path.
  if (trimmed.startsWith("//")) return { kind: "request", text: trimmed.slice(1) };
  if (!trimmed.startsWith("/")) return { kind: "request", text: trimmed };

  const body = trimmed.slice(1).trim();
  if (!body) return { kind: "invalid", message: "Type a command name after the slash." };
  const lower = body.replace(/\s+/g, " ").toLowerCase();
  const alias = Object.keys(ALIASES).find(name => lower === name || lower.startsWith(`${name} `));
  const names = catalog.map(command => command.name);
  const name = alias ?? names.filter(n => lower === n || lower.startsWith(`${n} `)).sort((a, b) => b.length - a.length)[0];
  if (!name) return { kind: "invalid", message: `There is no /${body.split(/\s+/)[0]} command. Type / to see the commands.` };
  const command = catalog.find(entry => entry.name === (ALIASES[name] ?? name))!;
  // Skip past the name's words, however they were spaced.
  const rest = body.split(/\s+/).slice(name.split(" ").length).join(" ").trim();
  const usage = barUsage(command);

  const argument = describedArgument(command);
  if (!argument) return { kind: "invalid", command: command.name, message: `/${command.name} needs more than the bar can take. Ask the Language Model instead, in plain words.` };

  let args: Record<string, unknown>;
  if (rest.startsWith("{")) {
    // Unadvertised, for testing: a JSON object after the name, as the old command line took.
    try {
      const parsed = JSON.parse(rest);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      args = parsed;
    } catch { return { kind: "invalid", command: command.name, message: "That JSON object could not be read." }; }
  } else if (argument.kind === "text") {
    if (!rest) return { kind: "invalid", command: command.name, message: `${usage} needs a ${argument.name}.` };
    args = { [argument.name]: rest };
  } else if (rest) {
    return { kind: "invalid", command: command.name, message: argument.kind === "tab" || argument.kind === "selection"
      ? `/${command.name} works on the current note and takes nothing after its name.`
      : `/${command.name} takes nothing after its name.` };
  } else if (argument.kind === "selection") {
    if (!sourceTabId) return { kind: "invalid", command: command.name, message: `/${command.name} works on the selected text in a note. Open one and select a passage first.` };
    return { kind: "command", command: command.name, args: {}, closes: CLOSES_BAR.has(command.name), selectionOf: sourceTabId };
  } else if (argument.kind === "tab") {
    if (!sourceTabId) return { kind: "invalid", command: command.name, message: `/${command.name} works on the current note. Open one first.` };
    args = { tabId: sourceTabId };
  } else {
    args = {};
  }
  // The writer asked for this, so anything it opens comes to the front.
  const properties = (command.inputSchema as CommandSchema).properties ?? {};
  if (properties.focus?.type === "boolean" && args.focus === undefined) args.focus = true;
  return { kind: "command", command: command.name, args, closes: CLOSES_BAR.has(command.name) };
}

export interface BarSummary { ok: boolean; title: string; lines: string[] }

const MAX_LINES = 12;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function label(item: unknown): string {
  if (!isRecord(item)) return String(item);
  for (const key of ["path", "name", "title", "command", "tabId", "id"]) {
    const value = item[key];
    if (typeof value === "string" && value) return value;
  }
  return JSON.stringify(item);
}

function capped(lines: string[]): string[] {
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES - 1), `…and ${lines.length - MAX_LINES + 1} more`] : lines;
}

function genericLines(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${value.length}`);
      lines.push(...value.slice(0, 8).map(item => `  ${label(item)}`));
      if (value.length > 8) lines.push(`  …and ${value.length - 8} more`);
    } else if (isRecord(value)) {
      lines.push(`${key}: ${label(value)}`);
    } else if (value !== null && value !== "") {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines;
}

/** A command result as a few lines a writer can read; the raw result stays available beside it. */
export function summarizeResult(result: CommandResult): BarSummary {
  if (!result.ok) return { ok: false, title: result.error.message, lines: [result.error.code] };
  const data = result.data;
  if (!isRecord(data)) return { ok: true, title: "Done.", lines: data === undefined || data === null ? [] : [String(data)] };

  switch (result.command) {
    case "notes search": {
      const notes = Array.isArray(data.notes) ? data.notes as Array<{ path: string; matches: Array<{ line: number; text: string }>; totalMatches: number }> : [];
      if (!notes.length) return { ok: true, title: `No notes contain "${data.query}".`, lines: [] };
      return { ok: true, title: `${plural(notes.length, "note")} ${notes.length === 1 ? "contains" : "contain"} "${data.query}".`, lines: capped(notes.map(note => {
        const first = note.matches[0];
        const more = note.totalMatches > 1 ? ` (+${note.totalMatches - 1} more)` : "";
        return `${note.path} · line ${first.line}: ${first.text.trim()}${more}`;
      })) };
    }
    case "notes list": {
      const notes = Array.isArray(data.notes) ? data.notes as Array<{ path: string; tabId: string | null }> : [];
      const drafts = Array.isArray(data.drafts) ? data.drafts.length : 0;
      return { ok: true, title: `${plural(notes.length, "note")}${drafts ? `, ${plural(drafts, "unsaved draft")}` : ""}.`,
        lines: capped(notes.map(note => `${note.path}${note.tabId ? " (open)" : ""}`)) };
    }
    case "commands list": {
      const commands = Array.isArray(data.commands) ? data.commands as CommandDescription[] : [];
      const ready = commands.filter(command => command.available && describedArgument(command));
      return { ok: true, title: `${plural(ready.length, "command")} can be typed here. Type / to browse them.`, lines: capped(ready.map(barUsage)) };
    }
    case "commands describe": {
      const command = data.command as CommandDescription;
      return { ok: true, title: command.description, lines: [describedArgument(command) ? barUsage(command) : "Ask the Language Model to run this one."] };
    }
    case "note open":
      return { ok: true, title: `Opened ${data.path}.`, lines: [] };
    case "document create":
      return { ok: true, title: "Created a new note.", lines: [] };
    default:
      return { ok: true, title: "Done.", lines: capped(genericLines(data)) };
  }
}
