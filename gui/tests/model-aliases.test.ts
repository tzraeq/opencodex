import { expect, test } from "bun:test";
import {
  isModelAliasName,
  modelAliasesPutBody,
  modelAliasTargetOptions,
  removeModelAlias,
  upsertModelAlias,
} from "../src/model-aliases";
import type { ModelRow } from "../src/pages/models-shared";

test("target suggestions use raw provider/model ids and exclude virtual selectors", () => {
  const models: ModelRow[] = [
    { provider: "openai", id: "gpt-5.6-sol", namespaced: "gpt-5.6-sol", disabled: false, native: true },
    { provider: "openai", id: "desktop/gpt-5.6-sol", namespaced: "desktop/gpt-5.6-sol", disabled: false, native: true },
    { provider: "combo", id: "fast", namespaced: "combo/fast", disabled: false },
    { provider: "nvidia", id: "moonshotai/kimi-k2.6", namespaced: "nvidia/moonshotai%2Fkimi-k2.6", disabled: false },
    { provider: "nvidia", id: "moonshotai/kimi-k2.6", namespaced: "duplicate", disabled: true },
  ];

  expect(modelAliasTargetOptions(models)).toEqual([
    "nvidia/moonshotai/kimi-k2.6",
    "openai/gpt-5.6-sol",
  ]);
});

test("alias names reject reserved JavaScript object keys", () => {
  expect(isModelAliasName("friendly")).toBe(true);
  for (const alias of ["__proto__", "prototype", "constructor", "Constructor"]) {
    expect(isModelAliasName(alias)).toBe(false);
  }
});

test("alias mutations replace renamed keys without mutating the previous map", () => {
  const aliases = { beta: "provider/b", old: "provider/a" };
  const renamed = upsertModelAlias(aliases, "old", "alpha", "provider/new/model");

  expect(aliases).toEqual({ beta: "provider/b", old: "provider/a" });
  expect(renamed).toEqual({ alpha: "provider/new/model", beta: "provider/b" });
  expect(removeModelAlias(renamed, "beta")).toEqual({ alpha: "provider/new/model" });
});

test("PUT payloads are complete, sorted replacement maps", () => {
  expect(modelAliasesPutBody({ zebra: "p/z", alpha: "p/a" })).toEqual({
    aliases: { alpha: "p/a", zebra: "p/z" },
  });
});
