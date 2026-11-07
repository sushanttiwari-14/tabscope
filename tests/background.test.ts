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
      sendMessage: async () => {},
      getURL: (p: string) => "chrome-extension://test/" + p,
      onMessage: runtime,
      onStartup: event(),
      onInstalled: event(),
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
      sendMessage: async () => true,
      onRemoved: event(),
      onUpdated: event(),
    },
    windows: {
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
    expect(session.schema).toBe(1);
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
  it("rejects webpage search messages and reports failed navigation", async () => {
    expect(
      (
        await send(
          { type: "search", query: "" },
          "https://example.com/palette.html",
        )
      ).error,
    ).toBe("Unauthorized request");
    await send({ type: "refresh" });
    await send({ type: "search", query: "" });
    failActivate = true;
    expect(
      (await send({ type: "navigate", id: 1, query: "ceramic" })).error,
    ).toContain("window disappeared");
  });
});
