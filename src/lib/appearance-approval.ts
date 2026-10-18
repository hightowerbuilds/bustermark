// Plain-language approval cards and Undo for layout changes the Assistant asks to make
// (growth/phases/phase-3.md, section 1).

/** Layout changes that get an Undo button in the chat once allowed. */
export const UNDOABLE_LAYOUT_COMMANDS = new Set(["appearance apply", "appearance presets apply", "appearance reset"]);
export const LAYOUT_APPROVAL_COMMANDS = new Set([...UNDOABLE_LAYOUT_COMMANDS, "appearance revert"]);

type Args = Record<string, unknown> | null | undefined;

const PADDING: Record<string, string> = { paddingTop: "Top", paddingBottom: "Bottom", paddingLeft: "Left", paddingRight: "Right" };

function describeChange(key: string, value: unknown): string {
  if (key === "alignment") return value === "center" ? "Centered column" : "Left-aligned column";
  if (key === "columnWidth") return value === 0 ? "Column fills the tab" : `${value} px column`;
  if (key === "lineHeight") return value === 0 ? "Default line spacing" : `Line spacing ${value}`;
  if (key === "fontSize") return value === 0 ? "Text size from Settings" : `${value} px text`;
  if (key === "background") return value === "theme" ? "The color scheme's page" : `${String(value).charAt(0).toUpperCase()}${String(value).slice(1)} page`;
  if (key in PADDING) return `${PADDING[key]} margin ${value} px`;
  return `${key}: ${String(value)}`;
}

/** Title and change list for a layout approval card, or null for other commands. */
export function describeLayoutApproval(command: string, args: Args, noteName: (tabId: string) => string | undefined): { title: string; changes: string[] } | null {
  if (!LAYOUT_APPROVAL_COMMANDS.has(command)) return null;
  const scope = args?.scope;
  const tabId = typeof args?.tabId === "string" ? args.tabId : "";
  const target = scope === "app" ? "every note" : scope === "workspace" ? "notes in this folder" : noteName(tabId) ?? "this note";
  if (command === "appearance revert") return { title: "Undo the last layout change?", changes: [] };
  if (command === "appearance reset") {
    return { title: scope === "app" ? "Reset the default layout for every note?" : `Reset the layout of ${target} to the defaults?`, changes: [] };
  }
  if (command === "appearance presets apply") return { title: `Use ${String(args?.name ?? "this layout")} for ${target}?`, changes: [] };
  const changes = args?.changes && typeof args.changes === "object" ? Object.entries(args.changes as Record<string, unknown>) : [];
  return { title: `Change the layout of ${target}?`, changes: changes.map(([key, value]) => describeChange(key, value)) };
}

/** The appearance revision an allowed change produced, read from its tool result. */
export function layoutRevision(result: string | undefined): number | null {
  try {
    const revision = JSON.parse(result ?? "").revision;
    return Number.isInteger(revision) ? revision : null;
  } catch { return null; }
}
