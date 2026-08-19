import { describe, expect, jest, test } from "bun:test";
import { routeModel } from "../src/router";
import { handleManagementAPI, type ManagementApiDeps } from "../src/server/management-api";
import type { OcxConfig } from "../src/types";

function baseConfig(): OcxConfig {
  return {
    port: 10100,
    defaultProvider: "openai",
    providers: {
      openai: {
        adapter: "openai-responses",
        baseUrl: "https://chatgpt.com/backend-api/codex",
      },
      acode: {
        adapter: "openai-chat",
        baseUrl: "https://api.acode.example/v1",
      },
      disabled: {
        adapter: "openai-chat",
        baseUrl: "https://api.disabled.example/v1",
        disabled: true,
      },
    },
  };
}

async function requestAliases(
  config: OcxConfig,
  method: "GET" | "PUT",
  body?: unknown,
  deps: ManagementApiDeps = { saveConfigPreservingClaudeCode: () => {} },
): Promise<Response> {
  const url = new URL("http://localhost/api/model-aliases");
  const response = await handleManagementAPI(new Request(url, {
    method,
    headers: {
      Host: "localhost",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
    }),
  }), url, config, deps);
  if (!response) throw new Error("model aliases route did not handle the request");
  return response;
}

describe("model aliases management API", () => {
  test("GET returns the global map", async () => {
    const config = baseConfig();
    config.modelAliases = { friendly: "acode/model" };

    const response = await requestAliases(config, "GET");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aliases: { friendly: "acode/model" } });
  });

  test("PUT replaces the complete map, persists the shared object, and routes immediately", async () => {
    const config = baseConfig();
    config.modelAliases = { stale: "acode/old" };
    const persist = jest.fn((_config: OcxConfig) => {});

    const response = await requestAliases(config, "PUT", {
      aliases: {
        "gpt-5.6-sol": "acode/kimi-k3",
        moonshot: "acode/vendor/family/model",
      },
    }, { saveConfigPreservingClaudeCode: persist });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      aliases: {
        "gpt-5.6-sol": "acode/kimi-k3",
        moonshot: "acode/vendor/family/model",
      },
    });
    expect(config.modelAliases).not.toHaveProperty("stale");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]?.[0]).toBe(config);
    expect(routeModel(config, "gpt-5.6-sol")).toMatchObject({ providerName: "acode", modelId: "kimi-k3" });
    expect(routeModel(config, "moonshot")).toMatchObject({ providerName: "acode", modelId: "vendor/family/model" });
  });

  test("an empty replacement removes the optional config field", async () => {
    const config = baseConfig();
    config.modelAliases = { friendly: "acode/model" };

    const response = await requestAliases(config, "PUT", { aliases: {} });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, aliases: {} });
    expect(Object.hasOwn(config, "modelAliases")).toBe(false);
  });

  test("rejects malformed names and targets without mutating the map", async () => {
    const invalidMaps: unknown[] = [
      [],
      { "bad/name": "acode/model" },
      { "bad alias": "acode/model" },
      { friendly: "acode" },
      { friendly: 42 },
      { constructor: "acode/model" },
      JSON.parse('{"__proto__":"acode/model"}'),
    ];

    for (const aliases of invalidMaps) {
      const config = baseConfig();
      config.modelAliases = { existing: "acode/model" };
      const response = await requestAliases(config, "PUT", { aliases });
      expect(response.status).toBe(400);
      expect(config.modelAliases).toEqual({ existing: "acode/model" });
    }
  });

  test("redacts secret-shaped alias input from validation errors", async () => {
    const secret = "customcredential123456";
    const response = await requestAliases(baseConfig(), "PUT", {
      aliases: { [`x-api-key: ${secret}`]: "acode/model" },
    });

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain("[REDACTED]");
    expect(body.error).not.toContain(secret);
  });

  test("rejects unknown and disabled target providers", async () => {
    for (const target of ["missing/model", "disabled/model"]) {
      const config = baseConfig();
      const response = await requestAliases(config, "PUT", { aliases: { friendly: target } });
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
      expect(config.modelAliases).toBeUndefined();
    }
  });

  test("rolls back the live map when persistence fails", async () => {
    const config = baseConfig();
    config.modelAliases = { existing: "acode/model" };

    await expect(requestAliases(config, "PUT", { aliases: { next: "acode/new" } }, {
      saveConfigPreservingClaudeCode: () => { throw new Error("disk full"); },
    })).rejects.toThrow("disk full");
    expect(config.modelAliases).toEqual({ existing: "acode/model" });
  });
});
