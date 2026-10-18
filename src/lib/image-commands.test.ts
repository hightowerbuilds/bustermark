import { describe, expect, it, vi } from "vitest";
import { isAssistantTool } from "./assistant-tools";
import { FeatureCommands } from "./feature-commands";
import { registerImageCommands, type FetchedImage, type ImageDeps } from "./image-commands";

const png: FetchedImage = { mimeType: "image/png", data: "iVBORw0KGgo=", bytes: 2_400_000, source: "https://upload.wikimedia.org/a.png" };

function fixture(overrides: Partial<ImageDeps> = {}) {
  const deps: ImageDeps = {
    fetch: vi.fn(async () => png),
    read: vi.fn(async (path: string) => ({ ...png, source: path })),
    shrink: vi.fn(async () => ({ mimeType: "image/jpeg", data: "/9j/small", width: 1568, height: 1045 })),
    search: vi.fn(async (query: string) => ({ query, provider: "Wikimedia Commons", note: "DuckDuckGo refused the image search.", results: [
      { title: "Starry Night", image: "https://upload.wikimedia.org/a-1280.jpg", thumbnail: "https://upload.wikimedia.org/a-1280.jpg", page: "https://commons.wikimedia.org/wiki/File:A.jpg", width: 1280, height: 1013 },
      { title: "Broken", image: "https://b.example/b.jpg", thumbnail: "https://b.example/thumb-fails.jpg", page: "", width: 800, height: 600 },
    ] })),
    page: vi.fn(async (url: string) => ({ page: url, title: "Blade Runner - Wikipedia", images: [{ url: "https://upload.wikimedia.org/poster.png", alt: "Preview image" }] })),
    ...overrides,
  };
  const commands = new FeatureCommands();
  registerImageCommands(commands, deps);
  const run = (args: Record<string, unknown>) => commands.dispatch({ command: "image view", args, requestId: crypto.randomUUID() }, "ai");
  return { deps, commands, run };
}

describe("image view", () => {
  it("fetches a web image, shrinks it, and attaches it for the model", async () => {
    const f = fixture();
    expect(await f.run({ url: "https://upload.wikimedia.org/a.png" })).toMatchObject({ ok: true, data: {
      source: "https://upload.wikimedia.org/a.png", width: 1568, height: 1045, originalBytes: 2_400_000,
      attachments: [{ mimeType: "image/jpeg", data: "/9j/small" }],
    } });
    expect(f.deps.fetch).toHaveBeenCalledWith("https://upload.wikimedia.org/a.png");
    expect(f.deps.shrink).toHaveBeenCalledWith(png);
  });

  it("reads an image file from the Notes folder", async () => {
    const f = fixture();
    expect(await f.run({ path: "/Notes/set.jpg" })).toMatchObject({ ok: true, data: { source: "/Notes/set.jpg" } });
    expect(f.deps.read).toHaveBeenCalledWith("/Notes/set.jpg");
  });

  it("needs exactly one of url and path", async () => {
    const f = fixture();
    expect(await f.run({})).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.run({ url: "https://a.org/a.png", path: "/a.png" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  });

  it("passes the native refusal back to the model", async () => {
    const f = fixture({ fetch: vi.fn(async () => { throw "That address points to this computer or a private network, which images cannot be fetched from."; }) });
    expect(await f.run({ url: "http://127.0.0.1/a.png" })).toMatchObject({ ok: false, error: { code: "IMAGE_UNAVAILABLE", message: expect.stringContaining("private network") } });
    expect(f.deps.shrink).not.toHaveBeenCalled();
  });

  it("is a read the Assistant can use without approval", () => {
    const f = fixture();
    for (const name of ["image view", "web images", "page images"]) {
      expect(isAssistantTool(name), name).toBe(true);
      expect(f.commands.describe().find(c => c.name === name), name).toMatchObject({ effect: "read" });
    }
  });
});

describe("web images and page images", () => {
  it("attaches small thumbnails of the results and skips one that fails", async () => {
    const f = fixture({ fetch: vi.fn(async (url: string) => { if (url.includes("fails")) throw "The site answered 404."; return png; }) });
    const result = await f.commands.dispatch({ command: "web images", args: { query: "Starry Night", count: 2 }, requestId: "r1" }, "ai");
    expect(result).toMatchObject({ ok: true, data: { provider: "Wikimedia Commons", note: expect.stringContaining("refused"),
      results: [{ title: "Starry Night", thumbnailAttached: true }, { title: "Broken", thumbnailAttached: false }],
      attachments: [{ mimeType: "image/jpeg", data: "/9j/small" }] } });
    expect(f.deps.shrink).toHaveBeenCalledWith(png, 400);
    expect(f.deps.search).toHaveBeenCalledWith("Starry Night", 2);
  });

  it("checks the query and reports a failed search", async () => {
    const f = fixture({ search: vi.fn(async () => { throw "Could not reach Wikimedia Commons."; }) });
    const run = (args: Record<string, unknown>) => f.commands.dispatch({ command: "web images", args, requestId: crypto.randomUUID() }, "ai");
    expect(await run({ query: "a", count: 11 })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await run({ query: "a" })).toMatchObject({ ok: false, error: { code: "IMAGE_SEARCH_FAILED" } });
  });

  it("lists a page's pictures for the model to view", async () => {
    const f = fixture();
    expect(await f.commands.dispatch({ command: "page images", args: { url: "https://en.wikipedia.org/wiki/Blade_Runner" }, requestId: "r2" }, "ai"))
      .toMatchObject({ ok: true, data: { title: "Blade Runner - Wikipedia", images: [{ url: "https://upload.wikimedia.org/poster.png" }] } });
  });
});
