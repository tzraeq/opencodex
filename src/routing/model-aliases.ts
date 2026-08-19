import type { OcxConfig, OcxProviderConfig } from "../types";

const MODEL_ALIAS_NAME_PATTERN = /^[^\s/]+$/;
const MODEL_ALIAS_TARGET_PATTERN = /^[^\s/]+\/[^\s]+$/;
const RESERVED_MODEL_ALIAS_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export interface ParsedModelAliasTarget {
  providerName: string;
  modelId: string;
  target: string;
}

export interface ResolvedModelAlias extends ParsedModelAliasTarget {
  provider: OcxProviderConfig;
}

export function isGlobalModelAliasName(value: string): boolean {
  return MODEL_ALIAS_NAME_PATTERN.test(value)
    && !RESERVED_MODEL_ALIAS_NAMES.has(value.toLowerCase());
}

/** Parse at the first slash so native model ids may retain additional slashes. */
export function parseGlobalModelAliasTarget(value: unknown): ParsedModelAliasTarget | null {
  if (typeof value !== "string") return null;
  const target = value.trim();
  if (!MODEL_ALIAS_TARGET_PATTERN.test(target)) return null;
  const slash = target.indexOf("/");
  return {
    providerName: target.slice(0, slash),
    modelId: target.slice(slash + 1),
    target,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export type ModelAliasesValidation =
  | { ok: true; aliases: Record<string, string> }
  | { ok: false; error: string };

/** Validate and normalize the complete replacement map accepted by the management API. */
export function validateGlobalModelAliases(
  value: unknown,
  providers: Record<string, OcxProviderConfig>,
): ModelAliasesValidation {
  if (!isPlainRecord(value)) {
    return { ok: false, error: "aliases must be an object" };
  }

  const normalized: Array<[string, string]> = [];
  for (const [alias, rawTarget] of Object.entries(value)) {
    if (!isGlobalModelAliasName(alias)) {
      return { ok: false, error: `invalid model alias "${alias}": aliases must be bare ids without slashes, whitespace, or reserved JavaScript object keys` };
    }
    const parsed = parseGlobalModelAliasTarget(rawTarget);
    if (!parsed) {
      return { ok: false, error: `invalid target for model alias "${alias}": expected provider/model` };
    }
    if (!Object.hasOwn(providers, parsed.providerName)) {
      return { ok: false, error: `unknown provider for model alias "${alias}": ${parsed.providerName}` };
    }
    if (providers[parsed.providerName]!.disabled === true) {
      return { ok: false, error: `provider is disabled for model alias "${alias}": ${parsed.providerName}` };
    }
    normalized.push([alias, parsed.target]);
  }

  normalized.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return { ok: true, aliases: Object.fromEntries(normalized) };
}

/** Resolve one configured alias directly; alias targets are never recursively re-routed. */
export function resolveGlobalModelAlias(
  config: Pick<OcxConfig, "modelAliases" | "providers">,
  requestedModel: string,
): ResolvedModelAlias | null {
  const aliases = config.modelAliases;
  if (!aliases || !Object.hasOwn(aliases, requestedModel)) return null;

  const parsed = parseGlobalModelAliasTarget(aliases[requestedModel]);
  if (!parsed) {
    throw new Error(`Invalid target for global model alias "${requestedModel}"`);
  }
  if (!Object.hasOwn(config.providers, parsed.providerName)) {
    throw new Error(`Global model alias "${requestedModel}" targets an unknown provider: ${parsed.providerName}`);
  }
  const provider = config.providers[parsed.providerName]!;
  if (provider.disabled === true) {
    throw new Error(`Global model alias "${requestedModel}" targets a disabled provider: ${parsed.providerName}`);
  }
  return { ...parsed, provider };
}
