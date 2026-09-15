import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { onAuthStateChange: vi.fn() },
    functions: { invoke }
  })
}));

async function loadWebDatabase() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  return import("./webDatabase.js");
}

describe("sendLineTestMessage", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.unstubAllEnvs();
  });

  it("invokes the authenticated line-test-message Edge Function and returns its actual delivery counts", async () => {
    const payload = { ok: true, groupRecipients: 1, privateRecipients: 2 };
    invoke.mockResolvedValue({ data: payload, error: null });
    const { sendLineTestMessage } = await loadWebDatabase();

    await expect(sendLineTestMessage()).resolves.toEqual(payload);
    expect(invoke).toHaveBeenCalledWith("line-test-message", { body: {} });
  });

  it("surfaces the Edge Function response error instead of the generic invoke error", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { json: vi.fn().mockResolvedValue({ error: "LINE group is not configured" }) }
      }
    });
    const { sendLineTestMessage } = await loadWebDatabase();

    await expect(sendLineTestMessage()).rejects.toThrow("LINE group is not configured");
  });

  it("surfaces an unsuccessful response payload from the Edge Function", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: "LINE channel access token is missing" },
      error: null
    });
    const { sendLineTestMessage } = await loadWebDatabase();

    await expect(sendLineTestMessage()).rejects.toThrow("LINE channel access token is missing");
  });
});

describe("desktopDatabase LINE test routing", () => {
  it("returns a safe unsupported error outside the web admin without exposing credentials", async () => {
    invoke.mockReset();
    vi.resetModules();
    vi.stubEnv("MODE", "test");
    const { sendLineTestMessage } = await import("./desktopDatabase.js");

    await expect(sendLineTestMessage()).resolves.toEqual({
      ok: false,
      error: "LINE test messaging is only available in the web admin."
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
