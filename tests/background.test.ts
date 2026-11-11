import { beforeEach, describe, it, expect, vi } from "vitest";
type Listener = (...args: unknown[]) => unknown;
const event = () => {
  const listeners: Listener[] = [];
  return { listeners, addListener: (fn: Listener) => listeners.push(fn) };
};
let tabs: {
  id: number;
  windowId: number;
  url: string;
  title: string;
  status: string;
  discarded?: boolean;
}[];
let local: Record<string, unknown>,
  session: Record<string, unknown>,
  grant: boolean;
let runtime: ReturnType<typeof event>;
let chromeMock: Record<string, unknown>;
let failActivate = false;
async function setup() {
  runtime = event();
  const store = (data: Record<string, unknown>) => ({
    get: async () => structuredClone(data),
    set: async (v: Record<string, unknown>) =>
      Object.assign(data, structuredClone(v)),
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
    },
    setAccessLevel: async () => {},
  });
  chromeMock = {
    runtime: {
      id: "test",
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      getContexts: async () => [],
      sendMessage: async () => {},
      getURL: (p: string) => "chrome-extension://test/" + p,
      onMessage: runtime,
      onStartup: event(),
      onInstalled: event(),
    },
    offscreen: {
      hasDocument: async () => false,
      closeDocument: async () => {},
      Reason: { WORKERS: "WORKERS" },
      createDocument: async () => {},
    },
    storage: { local: store(local), session: store(session) },
    tabs: {
      query: async () => tabs,
      get: async (id: number) => {
        const t = tabs.find((t) => t.id === id);
        if (!t) throw Error("closed");
        return t;
      },
      update: async () => {
        if (failActivate) throw Error("window disappeared");
      },
      sendMessage: vi.fn(async () => true),
      onActivated: event(),
      onRemoved: event(),
      onReplaced: event(),
      onUpdated: event(),
    },
    windows: {
      getAll: async () => [],
      create: vi.fn(async () => ({ id: 99 })),
      update: async () => {
        if (failActivate) throw Error("window disappeared");
      },
    },
    permissions: {
      contains: async () => grant,
      onAdded: event(),
      onRemoved: event(),
    },
    scripting: {
      executeScript: async (arg: { func?: unknown }) =>
        typeof arg.func === "function"
          ? [
              {
                result: {
                  url: tabs[0].url,
                  text: "An orbital ceramic engine",
                  truncated: false,
                },
              },
            ]
          : [],
    },
    action: { onClicked: event() },
    commands: { onCommand: event() },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("", { headers: { "content-type": "text/html" } }),
    ),
  );
  vi.stubGlobal("chrome", chromeMock);
  vi.resetModules();
  await import("../src/background");
}
function send(
  m: Record<string, unknown>,
  url = "chrome-extension://test/palette.html",
) {
  return new Promise<Record<string, unknown>>((resolve) => {
    runtime.listeners[0](m, { id: "test", url }, resolve);
  });
}
beforeEach(async () => {
  tabs = [
    {
      id: 1,
      windowId: 2,
      url: "https://example.com/",
      title: "Unrelated",
      status: "complete",
    },
  ];
  local = {};
  session = {};
  grant = true;
  failActivate = false;
  await setup();
});
describe("background lifecycle integration", () => {
  it("indexes, persists, recovers worker state, then cleans up closed tabs", async () => {
    await send({ type: "refresh" });
    let result = await send({ type: "search", query: "orbital ceramic" });
    expect(result.hits).toHaveLength(1);
    expect(session.schema).toBe(3);
    await setup();
    result = await send({ type: "search", query: "orbital ceramic" });
    expect(result.hits).toHaveLength(1);
    tabs = [];
    result = await send({ type: "search", query: "orbital ceramic" });
    expect(result.hits).toHaveLength(0);
  });
  it("clears text, pauses automatic reindexing and resumes explicitly", async () => {
    await send({ type: "refresh" });
    await send({ type: "search", query: "" });
    await send({ type: "clear" });
    await send({ type: "refresh" });
    expect(
      (await send({ type: "search", query: "ceramic" })).hits,
    ).toHaveLength(0);
    expect((local.preferences as { paused: boolean }).paused).toBe(true);
    await send({ type: "resume" });
    expect(
      (await send({ type: "search", query: "ceramic" })).hits,
    ).toHaveLength(1);
  });
  it("persists exclusions and purges on revocation without waking discarded tabs", async () => {
    await send({ type: "refresh" });
    await send({ type: "search", query: "" });
    await send({ type: "save", theme: "dark", exclusions: ["example.com"] });
    expect(
      (await send({ type: "search", query: "ceramic" })).hits,
    ).toHaveLength(0);
    expect((local.preferences as { theme: string }).theme).toBe("dark");
    await send({ type: "save", theme: "system", exclusions: [] });
    await send({ type: "search", query: "" });
    grant = false;
    expect(
      (await send({ type: "search", query: "ceramic" })).hits,
    ).toHaveLength(0);
    grant = true;
    tabs[0].discarded = true;
    await send({ type: "refresh" });
    expect(
      (await send({ type: "search", query: "ceramic" })).hits,
    ).toHaveLength(0);
  });
  it("does not restore a late extraction after clear has been requested", async () => {
    let release!: () => void;
    let started!: () => void;
    const beginning = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scripting = chromeMock.scripting as {
      executeScript: (args: { func?: unknown }) => Promise<unknown>;
    };
    const original = scripting.executeScript;
    scripting.executeScript = async (args) => {
      if (typeof args.func === "function") {
        started();
        await blocked;
      }
      return original(args);
    };
    const refresh = send({ type: "refresh" });
    await beginning;
    const cleared = send({ type: "clear" });
    release();
    await refresh;
    await cleared;
    expect(
      (await send({ type: "search", query: "ceramic" })).hits,
    ).toHaveLength(0);
    expect((session.records as { text: string }[]).every((r) => !r.text)).toBe(
      true,
    );
    expect((local.preferences as { paused: boolean }).paused).toBe(true);
  });
  it("rejects webpage search messages and reports failed navigation", async () => {
    expect(
      (
        await send(
          { type: "search", query: "" },
          "https://example.com/palette.html",
        )
      ).error,
    ).toBe("Unauthorized request");
    expect(
      (await send({ type: "search", query: "" }, "file:///palette.html")).error,
    ).toBe("Unauthorized request");
    await send({ type: "refresh" });
    await send({ type: "search", query: "" });
    failActivate = true;
    expect(
      (await send({ type: "navigate", id: 1, query: "ceramic" })).error,
    ).toContain("window disappeared");
  });
});

describe("coverage and new message boundaries", () => {
  it("keeps metadata through pause, permissions, exclusion, sleeping and restricted states", async () => {
    const reason = async () =>
      (
        (await send({ type: "search", query: "" })).coverage as {
          reason: string;
        }[]
      )[0].reason;
    grant = false;
    expect(await reason()).toBe("permission");
    expect(
      (await send({ type: "search", query: "Unrelated" })).hits,
    ).toHaveLength(1);
    grant = true;
    await send({ type: "save", theme: "system", exclusions: ["example.com"] });
    expect(await reason()).toBe("excluded");
    expect(
      (
        await send({
          type: "recover",
          action: "include",
          id: 1,
          url: tabs[0].url,
        })
      ).error,
    ).toBeUndefined();
    await send({ type: "search", query: "" });
    tabs[0].discarded = true;
    expect(await reason()).toBe("sleeping");
    tabs[0].url = "chrome://settings";
    expect(await reason()).toBe("restricted");
    await send({ type: "clear" });
    expect(await reason()).toBe("paused");
    expect(
      (await send({ type: "search", query: "Unrelated" })).hits,
    ).toHaveLength(1);
  });
  it("classifies extraction failure, allows a bounded retry and refuses stale recovery", async () => {
    const script = chromeMock.scripting as {
      executeScript: ReturnType<typeof vi.fn>;
    };
    script.executeScript = vi.fn(async () => {
      throw Error("blocked");
    });
    await send({ type: "refresh" });
    const response = await send({ type: "search", query: "" });
    expect((response.coverage as { reason: string }[])[0].reason).toBe(
      "failure",
    );
    const count = script.executeScript.mock.calls.length;
    await send({ type: "refresh" });
    await send({ type: "search", query: "" });
    expect(script.executeScript.mock.calls.length).toBe(count);
    expect(
      (
        await send({
          type: "recover",
          action: "retry",
          id: 1,
          url: "https://wrong.test",
        })
      ).error,
    ).toContain("changed");
    expect(
      (
        await send({
          type: "recover",
          action: "retry",
          id: 1,
          url: tabs[0].url,
        })
      ).error,
    ).toBeUndefined();
    await send({ type: "search", query: "" });
    expect(
      (
        await send({
          type: "recover",
          action: "retry",
          id: 1,
          url: tabs[0].url,
        })
      ).error,
    ).toContain("wait");
    await send({ type: "clear" });
    expect(
      (
        await send({
          type: "recover",
          action: "retry",
          id: 1,
          url: tabs[0].url,
        })
      ).error,
    ).toContain("Resume");
  });
  it("rejects malformed filters/recovery, and denies recovery from page scripts", async () => {
    expect(
      (await send({ type: "search", query: "", filters: { domain: [] } }))
        .error,
    ).toContain("Invalid filters");
    expect(
      (await send({ type: "search", query: "", filters: { pageText: "yes" } }))
        .error,
    ).toContain("Invalid filters");
    expect(
      (await send({ type: "recover", action: "eval", id: 1 })).error,
    ).toContain("Invalid recovery");
    expect(
      (await send({ type: "recover", action: "load", id: 1 }, tabs[0].url))
        .error,
    ).toContain("Unauthorized");
    expect(await send({ type: "overlay-ready", invocation: "old" })).toBe(
      false,
    );
  });
  it("tracks activation recency and retains it across worker initialization", async () => {
    tabs.push({ ...tabs[0], id: 2, url: "https://second.test/" });
    await send({ type: "search", query: "" });
    const onActivated = (
      chromeMock.tabs as { onActivated: ReturnType<typeof event> }
    ).onActivated;
    onActivated.listeners[0]({ tabId: 2 });
    expect(
      ((await send({ type: "search", query: "" })).hits as { id: number }[])[0]
        .id,
    ).toBe(2);
    await setup();
    expect(
      ((await send({ type: "search", query: "" })).hits as { id: number }[])[0]
        .id,
    ).toBe(2);
  });
  it("activates changed tabs without targeting stale text, and sends destination feedback", async () => {
    await send({ type: "refresh" });
    const response = await send({ type: "search", query: "ceramic" });
    const hit = (response.hits as { updated: number; url: string }[])[0];
    tabs[0].url = "https://example.com/changed";
    const result = await send({
      type: "navigate",
      id: 1,
      query: "ceramic",
      ...hit,
    });
    expect(result.activated).toBe(true);
    const messages = (
      chromeMock.tabs as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage.mock.calls;
    expect(
      messages.some((c) => (c[1] as { type: string }).type === "notice"),
    ).toBe(true);
    expect(
      messages.some(
        (c) => (c[1] as { type: string }).type === "navigate-match-v2",
      ),
    ).toBe(false);
  });
  it("cleans up an unready overlay once and ignores a late acknowledgment", async () => {
    const clicks = (
      chromeMock.action as { onClicked: ReturnType<typeof event> }
    ).onClicked;
    const messages = (
      chromeMock.tabs as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage;
    messages.mockImplementation(async () => ({ ready: false }));
    clicks.listeners[0](tabs[0]);
    await vi.waitFor(() =>
      expect(
        messages.mock.calls.some(
          (c) => (c[1] as { type: string }).type === "open",
        ),
      ).toBe(true),
    );
    await vi.waitFor(
      () =>
        expect(
          (chromeMock.windows as { create: ReturnType<typeof vi.fn> }).create,
        ).toHaveBeenCalledTimes(1),
      { timeout: 2500 },
    );
    expect(
      messages.mock.calls.some(
        (c) => (c[1] as { type: string }).type === "close",
      ),
    ).toBe(true);
    const open = messages.mock.calls.find(
      (c) => (c[1] as { type: string }).type === "open",
    )![1] as { invocation: string };
    expect(
      await send({ type: "overlay-ready", invocation: open.invocation }),
    ).toBe(false);
  });
});

describe("in-flight invalidation and overlay readiness", () => {
  it.each(["permission", "exclusion", "navigation"])(
    "does not commit extraction after %s changes",
    async (kind) => {
      let release!: () => void, started!: () => void;
      const blocked = new Promise<void>((r) => {
        release = r;
      });
      const beginning = new Promise<void>((r) => {
        started = r;
      });
      const script = chromeMock.scripting as {
        executeScript: (args: { func?: unknown }) => Promise<unknown>;
      };
      const original = script.executeScript;
      script.executeScript = async (args) => {
        if (args.func) {
          started();
          await blocked;
        }
        return original(args);
      };
      const refresh = send({ type: "refresh" });
      await beginning;
      let invalidation: Promise<unknown> | undefined;
      if (kind === "permission") grant = false;
      if (kind === "exclusion")
        invalidation = send({
          type: "save",
          theme: "system",
          exclusions: ["example.com"],
        });
      if (kind === "navigation") {
        tabs[0].url = "https://example.com/new";
        const updated = (
          chromeMock.tabs as { onUpdated: ReturnType<typeof event> }
        ).onUpdated;
        updated.listeners[0](1, { status: "loading" });
      }
      release();
      await refresh;
      await invalidation;
      expect(
        (await send({ type: "search", query: "ceramic" })).hits,
      ).toHaveLength(0);
    },
  );
  it("accepts readiness only from the expected tab and top document, coalescing rapid invocations", async () => {
    const script = chromeMock.scripting as {
      executeScript: (args: { func?: unknown }) => Promise<unknown>;
    };
    let documentId = "top";
    script.executeScript = async () => [
      {
        documentId,
        result: { url: tabs[0].url, text: "engine", truncated: false },
      },
    ];
    const clicks = (
      chromeMock.action as { onClicked: ReturnType<typeof event> }
    ).onClicked;
    const messages = (
      chromeMock.tabs as { sendMessage: ReturnType<typeof vi.fn> }
    ).sendMessage;
    messages.mockImplementation(async () => ({ ready: false }));
    clicks.listeners[0](tabs[0]);
    clicks.listeners[0](tabs[0]);
    await vi.waitFor(() =>
      expect(
        messages.mock.calls.some(
          (c) => (c[1] as { type: string }).type === "open",
        ),
      ).toBe(true),
    );
    const open = messages.mock.calls.find(
      (c) => (c[1] as { type: string }).type === "open",
    )![1] as { invocation: string };
    const ack = (id: number) =>
      new Promise((resolve) =>
        runtime.listeners[0](
          { type: "overlay-ready", invocation: open.invocation },
          {
            id: "test",
            url: "chrome-extension://test/overlay.html",
            tab: { id },
            frameId: 8,
            documentId: "frame",
          },
          resolve,
        ),
      );
    expect(await ack(2)).toBe(false);
    documentId = "new-document";
    expect(await ack(1)).toBe(false);
    documentId = "top";
    expect(await ack(1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      (chromeMock.windows as { create: ReturnType<typeof vi.fn> }).create,
    ).not.toHaveBeenCalled();
    expect(
      messages.mock.calls.filter(
        (c) => (c[1] as { type: string }).type === "open",
      ),
    ).toHaveLength(1);
  });
});

it("keeps content identity stable when dirty extraction returns unchanged text", async () => {
  await send({ type: "refresh" });
  const before = (
    (await send({ type: "search", query: "ceramic" })).hits as {
      updated: number;
    }[]
  )[0].updated;
  await new Promise((resolve) => setTimeout(resolve, 3));
  runtime.listeners[0](
    { type: "dirty", url: tabs[0].url },
    { id: "test", url: tabs[0].url, tab: tabs[0], frameId: 0 },
    () => {},
  );
  const after = (
    (await send({ type: "search", query: "ceramic" })).hits as {
      updated: number;
    }[]
  )[0].updated;
  expect(after).toBe(before);
});

it("invalidates old session schema bodies without losing metadata search", async () => {
  session.schema = 1;
  session.records = [
    {
      id: 1,
      windowId: 2,
      url: tabs[0].url,
      title: "Unrelated",
      text: "obsolete secret",
      state: "content",
      updated: 1,
    },
  ];
  await setup();
  expect(
    (await send({ type: "search", query: "obsolete secret" })).hits,
  ).toHaveLength(0);
  expect(
    (await send({ type: "search", query: "Unrelated" })).hits,
  ).toHaveLength(1);
});

it.each(["partial", "empty"])(
  "reports reliably extracted %s text",
  async (reason) => {
    (
      chromeMock.scripting as {
        executeScript: (arg: { func?: unknown }) => Promise<unknown>;
      }
    ).executeScript = async (arg) =>
      arg.func
        ? [
            {
              result: {
                url: tabs[0].url,
                text: reason === "empty" ? "" : "bounded body",
                truncated: reason === "partial",
              },
            },
          ]
        : [];
    await send({ type: "refresh" });
    const result = await send({ type: "search", query: "" });
    expect((result.coverage as { reason: string }[])[0].reason).toBe(reason);
  },
);

it("updates reused fallback window scope and restores it across worker suspension", async () => {
  tabs[0].url = "chrome://settings";
  tabs.push({ ...tabs[0], id: 2, windowId: 3, url: "chrome://version" });
  const clicks = (chromeMock.action as { onClicked: ReturnType<typeof event> })
    .onClicked;
  clicks.listeners[0](tabs[0]);
  await vi.waitFor(() =>
    expect(session.paletteContext).toEqual({ popup: 99, source: 2 }),
  );
  clicks.listeners[0](tabs[1]);
  await vi.waitFor(() =>
    expect(session.paletteContext).toEqual({ popup: 99, source: 3 }),
  );
  await setup();
  const result = await new Promise<Record<string, unknown>>((resolve) =>
    runtime.listeners[0](
      { type: "search", query: "", filters: { thisWindow: true } },
      {
        id: "test",
        url: "chrome-extension://test/palette.html?window=2",
        tab: { id: 100, windowId: 99 },
      },
      resolve,
    ),
  );
  expect((result.hits as { id: number }[]).map((h) => h.id)).toEqual([2]);
});

it.each(["clear", "permission", "exclusion", "navigation", "closure"])(
  "rejects late PDF page commits after %s",
  async (kind) => {
    tabs[0].url = "https://example.com/doc.pdf";
    let token = "";
    let finish!: (r: unknown) => void;
    (
      chromeMock.runtime as {
        sendMessage: (m: Record<string, unknown>) => Promise<unknown>;
      }
    ).sendMessage = async (m) => {
      if (m.type === "pdf-extract") {
        token = m.token as string;
        return new Promise((resolve) => (finish = resolve));
      }
    };
    await send({ type: "refresh" });
    await vi.waitFor(() => expect(token).not.toBe(""));
    if (kind === "clear") await send({ type: "clear" });
    if (kind === "exclusion")
      await send({
        type: "save",
        theme: "system",
        exclusions: ["example.com"],
      });
    if (kind === "permission") {
      grant = false;
      (
        chromeMock.permissions as { onRemoved: ReturnType<typeof event> }
      ).onRemoved.listeners[0]();
    }
    if (kind === "navigation") {
      tabs[0].url = "https://example.com/new";
      (
        chromeMock.tabs as { onUpdated: ReturnType<typeof event> }
      ).onUpdated.listeners[0](1, { status: "loading" });
    }
    if (kind === "closure") {
      tabs = [];
      (
        chromeMock.tabs as { onRemoved: ReturnType<typeof event> }
      ).onRemoved.listeners[0](1);
    }
    const late = await new Promise((resolve) =>
      runtime.listeners[0](
        {
          type: "pdf-progress",
          token,
          text: "private pdf secret",
          info: {
            pages: [{ page: 1, start: 0, end: 18 }],
            total: 1,
            searched: 1,
            textPages: 1,
            status: "ready",
          },
          done: true,
        },
        { id: "test", url: "chrome-extension://test/pdf-offscreen.html" },
        resolve,
      ),
    );
    expect(late).toBe(false);
    finish({ ok: true });
    expect(
      (await send({ type: "search", query: "private pdf secret" })).hits,
    ).toHaveLength(0);
  },
);

it("recovers interrupted PDF coverage after worker initialization and rejects old tokens", async () => {
  tabs[0].url = "https://example.com/doc.pdf";
  session.schema = 3;
  session.records = [
    {
      id: 1,
      windowId: 2,
      url: tabs[0].url,
      title: "PDF",
      text: "orbital ceramic",
      updated: 7,
      indexedAt: 10,
      state: "content",
      coverage: "indexing",
      pdf: {
        pages: [{ page: 1, start: 0, end: 15 }],
        total: 8,
        searched: 1,
        textPages: 1,
        identity: "fixture",
        status: "Indexing",
      },
    },
  ];
  await setup();
  const result = await send({ type: "search", query: "ceramic" });
  expect(result.hits).toHaveLength(1);
  expect(
    (result.coverage as { reason: string; detail: string }[])[0],
  ).toMatchObject({
    reason: "partial",
    detail: "Searched 1 of 8 pages · interrupted",
  });
  const old = await new Promise((resolve) =>
    runtime.listeners[0](
      {
        type: "pdf-progress",
        token: "old-worker-token",
        text: "secret",
        info: { pages: [], total: 1, searched: 0, textPages: 0, status: "old" },
      },
      { id: "test", url: "chrome-extension://test/pdf-offscreen.html" },
      resolve,
    ),
  );
  expect(old).toBe(false);
});

it("routes each keyboard invocation through toggle and accepts dismissal without a readiness timeout", async () => {
  const commands = chromeMock.commands as {
    onCommand: ReturnType<typeof event>;
  };
  const messages = (
    chromeMock.tabs as { sendMessage: ReturnType<typeof vi.fn> }
  ).sendMessage;
  messages.mockImplementation(async (_id, message) =>
    message.type === "toggle" ? { closed: true } : true,
  );
  commands.onCommand.listeners[0]("open-search");
  await vi.waitFor(() =>
    expect(messages.mock.calls.some((call) => call[1].type === "toggle")).toBe(
      true,
    ),
  );
  commands.onCommand.listeners[0]("open-search");
  await vi.waitFor(() =>
    expect(
      messages.mock.calls.filter((call) => call[1].type === "toggle"),
    ).toHaveLength(2),
  );
  expect(
    (chromeMock.windows as { create: ReturnType<typeof vi.fn> }).create,
  ).not.toHaveBeenCalled();
});
