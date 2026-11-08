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
it("targets repeated passages by original source position and folds Unicode without corrupting ranges", () => {
  const text = "The café horizon is near.";
  document.body.innerHTML = `<p>${text}</p><p>${"filler ".repeat(50)}</p><p id="target">${text}</p>`;
  expect(
    send({
      type: "highlight",
      excerpt: text,
      query: "cafe horizon",
      start: 380,
      expectedURL: location.href,
    }),
  ).toBe(true);
  const range = highlights.get("tabscope-match")!.ranges[0];
  expect(range.toString()).toBe("café horizon");
  expect(range.startContainer.parentElement?.id).toBe("target");
});
it("does not fall back to an unrelated query occurrence when a passage changed", () => {
  document.body.textContent = "event navigation only";
  expect(
    send({
      type: "highlight",
      excerpt: "The event horizon was here",
      query: "event horizon",
      start: 0,
      expectedURL: location.href,
    }),
  ).toBe(false);
  expect(highlights.size).toBe(0);
  expect(
    send({
      type: "highlight",
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
