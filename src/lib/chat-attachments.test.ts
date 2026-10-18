import { describe, expect, it, vi } from "vitest";
import { addAttachments, composeMessage, formatBytes, MAX_ATTACHMENTS, readAttachments, type AttachmentDeps, type ChatAttachment } from "./chat-attachments";

const text = (name: string, body: string, bytes = body.length): ChatAttachment => ({ id: name, kind: "text", name, text: body, bytes });
const image = (name: string): ChatAttachment => ({ id: name, kind: "image", name, mimeType: "image/jpeg", data: "/9j/x", width: 10, height: 10, bytes: 100 });

describe("chat attachments", () => {
  it("reads dropped files, shrinking images and reporting refusals by name", async () => {
    const deps: AttachmentDeps = {
      read: vi.fn(async (path: string) => {
        if (path.endsWith(".pdf")) throw "report.pdf can't be attached: the chat takes images (PNG, JPEG, GIF, WebP, HEIC) and text files.";
        return path.endsWith(".heic") ? { kind: "image" as const, name: "photo.heic", mimeType: "image/heic", data: "AAAA", bytes: 3_000_000 }
          : { kind: "text" as const, name: "notes.md", text: "# Notes", bytes: 7 };
      }),
      shrink: vi.fn(async () => ({ mimeType: "image/jpeg", data: "/9j/small", width: 1568, height: 1176 })),
    };
    const { attachments, errors } = await readAttachments(["/a/photo.heic", "/a/notes.md", "/a/report.pdf"], deps);
    expect(attachments.map(a => [a.kind, a.name])).toEqual([["image", "photo.heic"], ["text", "notes.md"]]);
    expect(attachments[0]).toMatchObject({ mimeType: "image/jpeg", data: "/9j/small", bytes: 3_000_000 });
    expect(deps.shrink).toHaveBeenCalledWith({ mimeType: "image/heic", data: "AAAA", bytes: 3_000_000, source: "photo.heic" });
    expect(errors).toEqual([expect.stringContaining("report.pdf can't be attached")]);
  });

  it("keeps to eight attachments and 512 KB of text, saying what was left out", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => image(`p${i}.png`));
    const capped = addAttachments([], many);
    expect(capped.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(capped.errors).toEqual(["A message can carry 8 attachments; p8.png was left out."]);
    const heavy = addAttachments([text("a.txt", "a", 300 * 1024)], [text("b.txt", "b", 300 * 1024)]);
    expect(heavy.attachments).toHaveLength(1);
    expect(heavy.errors[0]).toContain("b.txt would bring the attached text over 512 KB");
  });

  it("adds text files to the message in fences they can't close, and sends images separately", () => {
    const message = composeMessage("Compare these.", [text("plan.md", "Use ``` fences"), image("set.jpg")]);
    expect(message.text).toBe("Compare these.\n\nAttached file: plan.md\n````\nUse ``` fences\n````");
    expect(message.images).toEqual([{ mimeType: "image/jpeg", data: "/9j/x" }]);
    expect(composeMessage("", [image("a.jpg")]).text).toBe("Here is the attached file.");
    expect(composeMessage("  ", [image("a.jpg"), image("b.jpg")]).text).toBe("Here are the attached files.");
  });

  it("formats sizes", () => {
    expect([formatBytes(900), formatBytes(4096), formatBytes(3_500_000)]).toEqual(["900 B", "4 KB", "3.3 MB"]);
  });
});
