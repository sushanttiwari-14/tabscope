import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowAllWebsites,
  dismissAccessExplanation,
  shouldExplainAccess,
} from "../src/access";
function setup(granted = false, explained = false) {
  const data: Record<string, unknown> = { contentAccessExplained: explained };
  const request = vi.fn(async () => granted);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async () => ({ ...data }),
        set: async (v: Record<string, unknown>) => Object.assign(data, v),
      },
    },
    permissions: { contains: async () => granted, request },
  });
  return { data, request };
}
afterEach(() => vi.unstubAllGlobals());
describe("first-open website access choice", () => {
  it("explains access once, without automatically requesting permission", async () => {
    const { request } = setup();
    expect(await shouldExplainAccess()).toBe(true);
    expect(request).not.toHaveBeenCalled();
    await dismissAccessExplanation();
    expect(await shouldExplainAccess()).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("does not prompt existing all-site users", async () => {
    setup(true);
    expect(await shouldExplainAccess()).toBe(false);
  });
  it.each([true, false])(
    "remembers the explicit grant/deny choice (%s) and requests only HTTP(S)",
    async (granted) => {
      const { data, request } = setup(granted);
      expect(await allowAllWebsites()).toBe(granted);
      expect(request).toHaveBeenCalledWith({
        origins: ["http://*/*", "https://*/*"],
      });
      expect(data.contentAccessExplained).toBe(true);
      expect(await shouldExplainAccess()).toBe(false);
    },
  );
});
