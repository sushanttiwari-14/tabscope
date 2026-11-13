// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
vi.mock("../src/styles/tokens.css", () => ({
  default: "--backdrop:rgba(0,0,0,.35);--backdrop-blur:6px;",
}));
let listener: (
  m: Record<string, unknown>,
  s: Record<string, unknown>,
  reply: (v: unknown) => void,
) => void;
let highlights: Map<string, { ranges: Range[] }>;
beforeEach(async () => {
  delete (globalThis as { __tabscopeAgent?: unknown }).__tabscopeAgent;
  vi.useFakeTimers();
  vi.resetModules();
  delete (globalThis as { __tabscope?: boolean }).__tabscope;
  document.body.innerHTML = "";
  highlights = new Map();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal(
    "Highlight",
    class {
      constructor(public range: Range) {
        this.ranges = [range];
      }
      ranges: Range[];
    },
  );
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test",
      getURL: (p: string) => "chrome-extension://test/" + p,
      sendMessage: vi.fn(async () => {}),
      onMessage: {
        removeListener: vi.fn(),
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  await import("../src/content");
});
afterEach(() => {
  (
    globalThis as typeof globalThis & {
      __tabscopeAgent?: { dispose: () => void };
    }
  ).__tabscopeAgent?.dispose();
  window.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function send(message: Record<string, unknown>, sender = { id: "test" }) {
  let result: unknown;
  listener(message, sender, (v) => {
    result = v;
  });
  return result;
}
it("hands focus back to the overlay after loading and restores the page on close", () => {
  document.body.innerHTML = '<textarea id="composer"></textarea>';
  const composer = document.querySelector<HTMLTextAreaElement>("textarea")!;
  composer.focus();
  send({ type: "open", invocation: "focus-test", windowId: 1 });
  const frame = document
    .getElementById("tabscope-root")!
    .shadowRoot!.querySelector("iframe")!;
  const focus = vi.spyOn(frame, "focus");
  expect(composer.inert).toBe(true);
  frame.dispatchEvent(new Event("load"));
  expect(focus).toHaveBeenCalledOnce();
  send({ type: "ui-ready", invocation: "focus-test" });
  expect(focus).toHaveBeenCalledTimes(2);
  composer.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(focus).toHaveBeenCalledTimes(3);
  send({ type: "close", invocation: "focus-test" });
  expect(Boolean(document.body.inert)).toBe(false);
  expect(document.activeElement).toBe(composer);
});
it("preserves a page that was already inert when the overlay opened", () => {
  document.body.inert = true;
  send({ type: "open", invocation: "focus-test", windowId: 1 });
  send({ type: "close", invocation: "focus-test" });
  expect(document.body.inert).toBe(true);
  document.body.inert = false;
});
it("cleans up an orphaned overlay and its inert page after extension reload", async () => {
  const own = globalThis as typeof globalThis & {
    __tabscopeAgent?: { dispose: () => void };
  };
  own.__tabscopeAgent?.dispose();
  delete own.__tabscopeAgent;
  const orphan = document.createElement("div");
  orphan.id = "tabscope-root";
  orphan.dataset.tabscopeBlockedBody = "true";
  document.documentElement.append(orphan);
  document.body.inert = true;
  vi.resetModules();
  await import("../src/content");
  expect(orphan.isConnected).toBe(false);
  expect(Boolean(document.body.inert)).toBe(false);
  send({ type: "open", invocation: "after-reload", windowId: 1 });
  expect(document.querySelectorAll("#tabscope-root")).toHaveLength(1);
  send({ type: "close", invocation: "after-reload" });
  expect(Boolean(document.body.inert)).toBe(false);
});
it("targets repeated passages by original source position and folds Unicode without corrupting ranges", () => {
  const text = "The café horizon is near.";
  document.body.innerHTML = `<p>${text}</p><p>${"filler ".repeat(50)}</p><p id="target">${text}</p>`;
  expect(
    send({
      type: "navigate-match-v2",
      excerpt: text,
      query: "cafe horizon",
      start: 380,
      expectedURL: location.href,
    }),
  ).toBe(true);
  const range = highlights.get("tabscope-active-match")!.ranges[0];
  expect(range.toString()).toBe("café horizon");
  expect(range.startContainer.parentElement?.id).toBe("target");
});
it("does not fall back to an unrelated query occurrence when a passage changed", () => {
  document.body.textContent = "event navigation only";
  expect(
    send({
      type: "navigate-match-v2",
      excerpt: "The event horizon was here",
      query: "event horizon",
      start: 0,
      expectedURL: location.href,
    }),
  ).toBe(false);
  expect(highlights.size).toBe(0);
  expect(
    send({
      type: "navigate-match-v2",
      excerpt: "event",
      query: "event",
      start: 0,
      expectedURL: "https://wrong.test",
    }),
  ).toBeUndefined();
});
it("ignores foreign senders and exposes a short-lived destination status without an overlay", () => {
  expect(
    send({ type: "notice", text: "Page changed" }, { id: "foreign" }),
  ).toBeUndefined();
  expect(document.querySelector("[role=status]")).toBeNull();
  expect(send({ type: "notice", text: "Page changed" })).toBe(true);
  expect(document.querySelector("[role=status]")?.textContent).toContain(
    "Page changed",
  );
  expect(document.querySelector("#tabscope-root")).toBeNull();
  vi.advanceTimersByTime(7001);
  expect(document.querySelector("[role=status]")).toBeNull();
});

it("does not schedule page extraction for its own status insertion or removal", async () => {
  send({ type: "notice", text: "Page changed" });
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(7100);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

it("keeps the selected match highlighted until dismissal and supports buttons and arrows", async () => {
  document.body.innerHTML =
    '<p id="first">Orbit first passage</p><p id="second">Orbit second passage</p>';
  await Promise.resolve();
  const { SearchIndex } = await import("../src/search");
  const { extractReadable } = await import("../src/extract");
  const data = extractReadable();
  const index = new SearchIndex();
  index.rebuild(
    new Map([
      [
        1,
        {
          id: 1,
          windowId: 1,
          url: location.href,
          title: "Fixture",
          text: data.text,
          breaks: data.breaks,
          updated: 1,
          state: "content",
        },
      ],
    ]),
  );
  const hit = index.search("orbit")[0];
  expect(
    send({
      type: "navigate-match-v2",
      expectedURL: location.href,
      query: "orbit",
      excerpt: hit.passage!.text,
      start: hit.passage!.start,
      passages: hit.passages,
      passageId: hit.passage!.id,
    }),
  ).toBe(true);
  await Promise.resolve();
  expect(
    highlights.get("tabscope-active-match")!.ranges[0].startContainer
      .parentElement?.id,
  ).toBe("first");
  await vi.advanceTimersByTimeAsync(7100);
  expect(highlights.has("tabscope-active-match")).toBe(true);
  const nav = document.querySelector("#tabscope-match-navigator")!;
  expect(nav).not.toBeNull();
  const buttons = nav.querySelectorAll("button");
  expect(buttons[0].disabled).toBe(true);
  buttons[1].click();
  await Promise.resolve();
  expect(
    highlights.get("tabscope-active-match")!.ranges[0].startContainer
      .parentElement?.id,
  ).toBe("second");
  const nextNav = document.querySelector("#tabscope-match-navigator")!;
  expect(nextNav.textContent).toContain("Match 2 of 2");
  expect(nextNav.querySelectorAll("button")[1].disabled).toBe(true);
  const unrelated = document.createElement("div");
  unrelated.textContent = "Live clock updated";
  document.body.append(unrelated);
  await Promise.resolve();
  expect(highlights.has("tabscope-active-match")).toBe(true);
  expect(document.querySelector("#tabscope-match-navigator")).not.toBeNull();
  nextNav.querySelectorAll("button")[0].click();
  await Promise.resolve();
  expect(
    highlights.get("tabscope-active-match")!.ranges[0].startContainer
      .parentElement?.id,
  ).toBe("first");
  const key = (name: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    document.body.dispatchEvent(event);
    return event;
  };
  expect(key("ArrowLeft").defaultPrevented).toBe(true);
  expect(
    document.querySelector("#tabscope-match-navigator")!.textContent,
  ).toContain("Match 1 of 2");
  for (const options of [
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { isComposing: true },
  ])
    expect(key("ArrowRight", options).defaultPrevented).toBe(false);
  const field = document.createElement("input");
  document.body.append(field);
  await Promise.resolve();
  const editKey = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  field.dispatchEvent(editKey);
  expect(editKey.defaultPrevented).toBe(false);
  expect(
    document.querySelector("#tabscope-match-navigator")!.textContent,
  ).toContain("Match 1 of 2");
  expect(key("ArrowRight").defaultPrevented).toBe(true);
  expect(
    document.querySelector("#tabscope-match-navigator")!.textContent,
  ).toContain("Match 2 of 2");
  expect(
    highlights.get("tabscope-active-match")!.ranges[0].startContainer
      .parentElement?.id,
  ).toBe("second");
  key("ArrowRight");
  expect(
    document.querySelector("#tabscope-match-navigator")!.textContent,
  ).toContain("Match 2 of 2");
  key("ArrowLeft");
  expect(
    document.querySelector("#tabscope-match-navigator")!.textContent,
  ).toContain("Match 1 of 2");
  document
    .querySelector("#tabscope-match-navigator")!
    .querySelectorAll("button")[2]
    .click();
  expect(highlights.size).toBe(0);
  expect(document.querySelector("#tabscope-match-navigator")).toBeNull();
});

it("navigates every occurrence inside one passage and ends on an outside click", async () => {
  const text = "Orbit one Orbit two Orbit three";
  document.body.innerHTML =
    '<p id="words">' + text + '</p><button id="outside">Outside</button>';
  await Promise.resolve();
  const ranges = [...text.matchAll(/Orbit/g)].map((m) => ({
    start: m.index!,
    end: m.index! + 5,
  }));
  const passage = {
    id: "fixture",
    start: 0,
    end: text.length,
    text,
    ranges,
    kind: "exact",
    revision: 1,
    before: "",
    after: "",
    score: 1,
  };
  expect(
    send({
      type: "navigate-match-v2",
      expectedURL: location.href,
      query: "orbit",
      excerpt: text,
      start: 0,
      passages: [passage],
      passageId: passage.id,
    }),
  ).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(highlights.has("tabscope-active-match")).toBe(true);
  const press = (key: string) => {
    const e = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(e);
    return e;
  };
  expect(highlights.get("tabscope-active-match")!.ranges[0].startOffset).toBe(
    0,
  );
  press("ArrowRight");
  expect(highlights.get("tabscope-active-match")!.ranges[0].startOffset).toBe(
    10,
  );
  expect(
    document.querySelector("#tabscope-match-navigator")!.textContent,
  ).toContain("Match 2 of 3");
  document
    .querySelector("#tabscope-match-navigator")!
    .querySelectorAll("button")[1]
    .click();
  expect(highlights.get("tabscope-active-match")!.ranges[0].startOffset).toBe(
    20,
  );
  press("ArrowLeft");
  expect(highlights.get("tabscope-active-match")!.ranges[0].startOffset).toBe(
    10,
  );
  const outside = document.querySelector("#outside")!;
  const clicked = vi.fn();
  outside.addEventListener("click", clicked);
  outside.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  expect(clicked).toHaveBeenCalledOnce();
  expect(highlights.size).toBe(0);
  expect(document.querySelector("#tabscope-match-navigator")).toBeNull();
  expect(press("ArrowRight").defaultPrevented).toBe(false);
});

it("does not rescan the full DOM for each arrow and relocates equivalent replaced nodes", async () => {
  const text = "Orbit one Orbit two";
  document.body.innerHTML = '<p id="words">' + text + "</p>";
  await Promise.resolve();
  const rangeList = [...text.matchAll(/Orbit/g)].map((m) => ({
    start: m.index!,
    end: m.index! + 5,
  }));
  const p = {
    id: "cache",
    start: 0,
    end: text.length,
    text,
    ranges: rangeList,
    kind: "exact",
    revision: 1,
    before: "",
    after: "",
    score: 1,
  };
  const scans = vi.spyOn(document, "createTreeWalker");
  send({
    type: "navigate-match-v2",
    expectedURL: location.href,
    query: "orbit",
    excerpt: text,
    start: 0,
    passages: [p],
    passageId: p.id,
  });
  await Promise.resolve();
  expect(scans).toHaveBeenCalledTimes(1);
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowRight"])
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  await Promise.resolve();
  expect(scans).toHaveBeenCalledTimes(1);
  expect(highlights.get("tabscope-active-match")!.ranges[0].startOffset).toBe(
    10,
  );
  document.querySelector("#words")!.textContent = text;
  await Promise.resolve();
  await Promise.resolve();
  expect(highlights.get("tabscope-active-match")!.ranges[0].startOffset).toBe(
    10,
  );
  expect(scans).toHaveBeenCalledTimes(2);
  scans.mockRestore();
});
it("replaces a previous agent build and ignores the legacy highlight protocol", async () => {
  const own = globalThis as typeof globalThis & {
    __tabscopeAgent: { version: string; dispose: () => void };
  };
  const previous = listener;
  own.__tabscopeAgent.version = "older-build";
  vi.resetModules();
  await import("../src/content");
  expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(
    previous,
  );
  expect(listener).not.toBe(previous);
  expect(
    send({
      type: "highlight",
      expectedURL: location.href,
      query: "orbit",
      excerpt: "orbit",
      start: 0,
    }),
  ).toBeUndefined();
});

it("toggles the overlay and restores focus without requiring Control to be released", () => {
  document.body.innerHTML = '<textarea id="composer"></textarea>';
  const composer = document.querySelector("textarea")!;
  composer.focus();
  send({ type: "toggle", invocation: "first", windowId: 1 });
  expect(document.getElementById("tabscope-root")).not.toBeNull();
  send({ type: "ui-ready", invocation: "first" });
  expect(send({ type: "toggle", invocation: "second", windowId: 1 })).toEqual({
    closed: true,
  });
  expect(document.getElementById("tabscope-root")).toBeNull();
  expect(Boolean(document.body.inert)).toBe(false);
  expect(document.activeElement).toBe(composer);
  send({ type: "toggle", invocation: "third", windowId: 1 });
  expect(document.querySelectorAll("#tabscope-root")).toHaveLength(1);
});

it("reverses an in-flight dismissal without removing the reopened frame", async () => {
  const animations: {
    cancel: ReturnType<typeof vi.fn>;
    finished: Promise<void>;
    finish: () => void;
  }[] = [];
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    writable: true,
    value: () => [],
  });
  const animate = vi
    .spyOn(HTMLElement.prototype, "animate")
    .mockImplementation(() => {
      let finish!: () => void;
      let reject!: (reason: Error) => void;
      const finished = new Promise<void>((resolve, fail) => {
        finish = () => resolve();
        reject = fail;
      });
      // Browsers reject finished when an animation is cancelled.
      void finished.catch(() => {});
      const animation = {
        finished,
        finish,
        cancel: vi.fn(() => reject(Error("cancelled"))),
      };
      animations.push(animation);
      return animation as unknown as Animation;
    });
  const getAnimations = vi
    .spyOn(HTMLElement.prototype, "getAnimations")
    .mockImplementation(() => []);
  send({ type: "toggle", invocation: "first", windowId: 1 });
  send({ type: "ui-ready", invocation: "first" });
  const host = document.getElementById("tabscope-root");
  send({ type: "toggle", invocation: "second", windowId: 1 });
  expect(host?.isConnected).toBe(true);
  const dismissal = animations.at(-1)!;
  expect(send({ type: "toggle", invocation: "third", windowId: 1 })).toEqual({
    ready: true,
    pendingInvocation: "first",
  });
  await Promise.resolve();
  expect(dismissal.cancel).toHaveBeenCalledOnce();
  expect(document.getElementById("tabscope-root")).toBe(host);
  expect(Boolean(document.body.inert)).toBe(false);
  send({ type: "toggle", invocation: "fourth", windowId: 1 });
  animations.at(-1)!.finish();
  await Promise.resolve();
  expect(host?.isConnected).toBe(false);
  expect(Boolean(document.body.inert)).toBe(false);
  animate.mockRestore();
  getAnimations.mockRestore();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
});

it("requests reanalysis when the document language hint changes", async () => {
  document.documentElement.lang = "tr";
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(5100);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: "dirty",
    url: location.href,
  });
  document.documentElement.lang = "";
});

it("blocks page regions without toggling the body's site-owned modal state", () => {
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  document.body.innerHTML =
    '<main id="page">Search results</main><aside inert>Already blocked</aside>';
  send({ type: "open", invocation: "body-state", windowId: 1 });
  expect(Boolean(document.body.inert)).toBe(false);
  expect((document.querySelector("main") as HTMLElement).inert).toBe(true);
  send({ type: "close", invocation: "body-state" });
  expect((document.querySelector("main") as HTMLElement).inert).toBe(false);
  expect(document.querySelector("aside")!.hasAttribute("inert")).toBe(true);
});
