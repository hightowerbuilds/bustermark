import { describe, expect, it } from "vitest";
import { DecorationSet } from "prosemirror-view";
import { EditorState } from "prosemirror-state";
import { asciiArtDecorations, capLetter } from "./ascii-art";
import { blockSchema, parseBlocks } from "./block-markdown";

const alpha = "Alpha opens a paragraph with enough text for a drop cap.";
const beta = "Beta opens another paragraph with enough text for a drop cap.";
const gamma = "Gamma opens a third paragraph with enough text for a drop cap.";

describe("capLetter", () => {
  it("takes leading punctuation and the first letter or digit, as ::first-letter does", () => {
    expect(capLetter("Well, undoubtedly")).toBe("W");
    expect(capLetter("  “Quoted” start")).toBe("“Q");
    expect(capLetter("1890 was")).toBe("1");
    expect(capLetter("Élan vital")).toBe("É");
    expect(capLetter("— dash first")).toBeNull();
    expect(capLetter("   ")).toBeNull();
  });
});

describe("asciiArtDecorations", () => {
  const keys = (doc: ReturnType<typeof parseBlocks>, seen: Set<string>) =>
    asciiArtDecorations(doc, seen).filter(decoration => (decoration.spec as { key?: string }).key)
      .map(decoration => [decoration.from, (decoration.spec as { key: string }).key] as const);

  it("draws short Heading 1 and 2 and long paragraphs, but leaves other headings and nested prose alone", () => {
    const doc = parseBlocks(`# Title\n\n## Part one\n\n### Smaller\n\n${alpha}\n\n- ${beta}\n\n> ${gamma}\n\n“Second” paragraph has enough text for a drop cap.`);
    const widgets = keys(doc, new Set());
    expect(widgets.map(([, key]) => key)).toEqual(["ascii-heading:1", "ascii-heading:2", "ascii-cap:A", "ascii-cap:“S"]);
    expect(widgets.map(([from]) => doc.resolve(from).parent.type.name)).toEqual(["heading", "heading", "paragraph", "paragraph"]);
  });

  it.each(["12", "Page 12", "[Pg 123]", "xviii", "Chapter IV", "Note:", "October 17, 2026", "Best,", "Luke", "", "<p></p>"])("leaves short fragment %j entirely undecorated", source => {
    const seen = new Set<string>();
    expect(asciiArtDecorations(parseBlocks(source), seen)).toEqual([]);
    expect(seen.size).toBe(0);
  });

  it("starts at 40 visible characters and removes both decorations when editing back below the cutoff", () => {
    const seen = new Set<string>();
    let state = EditorState.create({ doc: parseBlocks("A".repeat(39)) });
    expect(asciiArtDecorations(state.doc, seen)).toEqual([]);
    state = state.apply(state.tr.insertText("a", 40));
    expect(keys(state.doc, seen)).toEqual([[1, "ascii-cap:A"]]);
    expect(asciiArtDecorations(state.doc, seen)).toHaveLength(2);
    state = state.apply(state.tr.delete(40, 41));
    expect(asciiArtDecorations(state.doc, seen)).toEqual([]);
    state = state.apply(state.tr.insertText("a", 40));
    expect(keys(state.doc, seen)).toEqual([[1, "ascii-cap:A"]]);
    expect(seen.size).toBe(1);
  });

  it("counts visible text rather than Markdown syntax, link destinations, or whitespace padding", () => {
    for (const source of ["**Page 12**", "[Page 12](https://example.com/a-long-address-that-is-not-paragraph-text)", `Page${" ".repeat(80)}12`]) {
      expect(asciiArtDecorations(parseBlocks(source), new Set()), source).toEqual([]);
    }
    const padded = blockSchema.node("doc", null, [blockSchema.node("paragraph", null, blockSchema.text(`   ${"A".repeat(39)}   `))]);
    expect(asciiArtDecorations(padded, new Set())).toEqual([]);
    expect(keys(parseBlocks(`**${alpha}**`), new Set()).map(([, key]) => key)).toEqual(["ascii-cap:A"]);
  });

  it("counts accented letters and emoji as single visible characters", () => {
    for (const text of [`A${"e\u0301".repeat(20)}`, `A${"👩‍💻".repeat(20)}`]) {
      expect(asciiArtDecorations(parseBlocks(text), new Set())).toEqual([]);
    }
    expect(keys(parseBlocks(`A${"e\u0301".repeat(39)}`), new Set())).toEqual([[1, "ascii-cap:A"]]);
  });

  it("counts a hard break as a space between words", () => {
    const doc = parseBlocks(`${"A".repeat(19)}  \n${"b".repeat(20)}`);
    expect(keys(doc, new Set())).toEqual([[1, "ascii-cap:A"]]);
  });

  it("hides each paragraph's real first letter (with its punctuation) behind the cap", () => {
    const doc = parseBlocks("  “Quoted” start to a paragraph with enough text.\n\nPlain opening to a paragraph with enough text.");
    const hidden = asciiArtDecorations(doc, new Set()).filter(decoration => !(decoration.spec as { key?: string }).key)
      .map(decoration => doc.textBetween(decoration.from, decoration.to));
    expect(hidden).toEqual(["“Q", "P"]);
  });

  it("keys a heading by its level, so typing in it keeps its widget", () => {
    const seen = new Set<string>();
    expect(keys(parseBlocks("# Typewri"), seen)).toEqual(keys(parseBlocks("# Typewritten"), seen));
  });

  it("decides once per document and remembers every block it has shown", () => {
    const seen = new Set<string>();
    const doc = parseBlocks(`# Heading\n\n${alpha}\n\n${beta}`);
    const first = asciiArtDecorations(doc, seen);
    expect(asciiArtDecorations(doc, seen)).toBe(first);
    expect([...seen]).toEqual(["h1:Heading", `p:${alpha}`, `p:${beta}`]);
    // The same text parsed again (an undo or assistant edit) is already known.
    asciiArtDecorations(parseBlocks(`# Heading\n\n${alpha}\n\n${beta}\n\n${gamma}`), seen);
    expect([...seen]).toEqual(["h1:Heading", `p:${alpha}`, `p:${beta}`, `p:${gamma}`]);
  });

  it("survives being built into a DecorationSet more than once for the same document", () => {
    const seen = new Set<string>();
    const doc = parseBlocks(`# Heading\n\n${alpha}\n\n${beta}`);
    // DecorationSet.create nulls the entries of the array it is given.
    // Three widgets, and the two paragraphs' hidden first letters.
    for (let i = 0; i < 3; i++) expect(DecorationSet.create(doc, [...asciiArtDecorations(doc, seen)]).find()).toHaveLength(5);
    expect(asciiArtDecorations(doc, seen).every(Boolean)).toBe(true);
  });
});
