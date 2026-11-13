// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PDF_LIMITS } from "../src/pdf";
const mock = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: mock.getDocument,
  GlobalWorkerOptions: {},
  PermissionFlag: { COPY: 16 },
}));
let listener: (
  m: Record<string, unknown>,
  sender: Record<string, unknown>,
  reply: (r: unknown) => void,
) => unknown;
let messages: Record<string, unknown>[];
let destroyed: ReturnType<typeof vi.fn>;
function documentFixture(
  pages: string[],
  labels: string[] | null = null,
  permissions: Set<number> | null = null,
) {
  destroyed = vi.fn(async () => {});
  mock.getDocument.mockReturnValue({
    destroy: destroyed,
    promise: Promise.resolve({
      numPages: pages.length,
      fingerprints: ["fixture"],
      getPermissions: async () => permissions,
      getPageLabels: async () => labels,
      getPage: async (n: number) => ({
        getTextContent: async () => ({
          items: pages[n - 1]
            ? [
                {
                  str: pages[n - 1],
                  transform: [12, 0, 0, 12, 10, 700],
                  width: 80,
                },
              ]
            : [],
        }),
        cleanup: () => {},
      }),
    }),
  });
}
beforeEach(async () => {
  vi.resetModules();
  messages = [];
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test",
      getURL: (p: string) => `chrome-extension://test/${p}`,
      onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
      sendMessage: async (m: Record<string, unknown>) => {
        messages.push(structuredClone(m));
        return true;
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("%PDF-fixture", {
          headers: { "content-type": "application/pdf" },
        }),
    ),
  );
  documentFixture(["connection timeout", "ceramic engine"]);
  await import("../src/pdf-offscreen");
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const sender = { id: "test", url: "chrome-extension://test/background.js" };
const extract = () =>
  new Promise<Record<string, unknown>>((resolve) =>
    listener(
      {
        type: "pdf-extract",
        url: "https://example.test/doc",
        token: "fixture",
      },
      sender,
      (r) => resolve(r as Record<string, unknown>),
    ),
  );
it("indexes incrementally with physical pages, labels, identity and mixed coverage", async () => {
  documentFixture(["", "connection timeout"], ["i", "A-1"]);
  expect(await extract()).toEqual({ ok: true });
  expect(messages).toHaveLength(3);
  const info = messages.at(-1)!.info as {
    pages: { page: number; label: string; start: number; end: number }[];
    textPages: number;
    searched: number;
    identity: string;
  };
  expect(info.pages[1]).toMatchObject({ page: 2, label: "A-1", start: 0 });
  expect(info.textPages).toBe(1);
  expect(info.identity).toBe("fixture");
  expect(info.searched).toBe(2);
  expect(destroyed).toHaveBeenCalled();
});
it("stops at forty pages and labels partial coverage", async () => {
  documentFixture(Array.from({ length: 45 }, () => "orbital ceramic"));
  await extract();
  const info = messages.at(-1)!.info as {
    searched: number;
    total: number;
    status: string;
  };
  expect(info.searched).toBe(40);
  expect(info.total).toBe(45);
  expect(info.status).toContain("40 of 45");
});
it("reports image-only PDFs without inventing matches", async () => {
  documentFixture(["", ""]);
  await extract();
  expect((messages.at(-1)!.info as { status: string }).status).toContain(
    "Scanned PDFs are not supported",
  );
  expect(messages.at(-1)!.text).toBe("");
});
it.each([
  [401, "application/pdf", {}, "HTTP 401"],
  [200, "text/html", {}, "did not return a PDF"],
  [
    200,
    "application/pdf",
    { "content-disposition": "attachment" },
    "Download-only",
  ],
  [
    200,
    "application/pdf",
    { "content-length": String(PDF_LIMITS.bytes + 1) },
    "12 MB",
  ],
])(
  "handles HTTP/type/disposition/size failures: %s %s",
  async (status, type, headers, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("%PDF-fixture", {
            status,
            headers: { "content-type": type, ...headers },
          }),
      ),
    );
    expect(String((await extract()).error)).toContain(expected);
    expect(messages).toHaveLength(0);
  },
);
it("rejects malformed content and password protection", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("garbage", {
          headers: { "content-type": "application/pdf" },
        }),
    ),
  );
  expect(String((await extract()).error)).toContain("not a valid PDF");
  await Promise.resolve();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("%PDF-fixture", {
          headers: { "content-type": "application/pdf" },
        }),
    ),
  );
  mock.getDocument.mockReturnValue({
    destroy: vi.fn(async () => {}),
    promise: Promise.reject(
      Object.assign(Error("password"), { name: "PasswordException" }),
    ),
  });
  expect(String((await extract()).error)).toContain("Password-protected");
});
it("cancels fetch immediately and never follows redirects", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          expect(options.redirect).toBe("error");
          options.signal!.addEventListener("abort", () =>
            reject(Error("aborted")),
          );
        }),
    ),
  );
  const done = extract();
  listener({ type: "pdf-cancel", token: "fixture" }, sender, () => {});
  expect(String((await done).error)).toContain("canceled");
  expect(messages).toHaveLength(0);
});
it("ignores content-script senders, unsafe protocols and foreign extension pages", () => {
  for (const s of [
    { ...sender, tab: { id: 1 } },
    { id: "foreign", url: sender.url },
    { id: "test", url: "chrome-extension://test/palette.html" },
  ])
    expect(
      listener(
        {
          type: "pdf-extract",
          url: "https://example.test/doc",
          token: "fixture",
        },
        s,
        () => {},
      ),
    ).toBeUndefined();
  expect(
    listener(
      { type: "pdf-extract", url: "file:///doc.pdf", token: "fixture" },
      sender,
      () => {},
    ),
  ).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it("respects PDF copy restrictions before extracting any page", async () => {
  documentFixture(["private"], null, new Set());
  expect(String((await extract()).error)).toContain(
    "does not allow text extraction",
  );
  expect(messages).toHaveLength(0);
});

it("reports replacement characters as limited extraction while preserving original text", async () => {
  documentFixture(["café \ufffd unknown"]);
  await extract();
  expect(messages.at(-1)!.text).toBe("café \ufffd unknown");
  expect(messages.at(-1)!.info).toMatchObject({ replacementCharacters: true });
  expect((messages.at(-1)!.info as { status: string }).status).toContain(
    "replacement characters",
  );
});

it("keeps PDF caps visible when grapheme-safe clipping ends below the numeric limit", async () => {
  documentFixture(["a".repeat(PDF_LIMITS.text - 1) + "👩‍💻tail"]);
  await extract();
  expect(messages.at(-1)!.text).toBe("a".repeat(PDF_LIMITS.text - 1));
  expect(messages.at(-1)!.info).toMatchObject({ truncated: true });
  expect((messages.at(-1)!.info as { status: string }).status).toContain(
    "text limit reached",
  );
  messages = [];
  documentFixture(["a".repeat(PDF_LIMITS.text - 5), "👩‍💻tail"]);
  await extract();
  expect((messages.at(-1)!.text as string).length).toBeLessThan(
    PDF_LIMITS.text,
  );
  expect(messages.at(-1)!.info).toMatchObject({ truncated: true });
});
