import type { ModelRow } from "./pages/models-shared";

const ALIAS_PATTERN = /^[^\s/]+$/;
const TARGET_PATTERN = /^[^\s/]+\/[^\s]+$/;
const RESERVED_ALIAS_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export function isModelAliasName(value: string): boolean {
  return ALIAS_PATTERN.test(value) && !RESERVED_ALIAS_NAMES.has(value.toLowerCase());
}

export function isModelAliasTarget(value: string): boolean {
  return TARGET_PATTERN.test(value);
}

function sortedAliases(entries: Iterable<readonly [string, string]>): Record<string, string> {
  return Object.fromEntries([...entries].sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

export function upsertModelAlias(
  aliases: Readonly<Record<string, string>>,
  originalAlias: string | null,
  alias: string,
  target: string,
): Record<string, string> {
  const entries = Object.entries(aliases).filter(([name]) => name !== originalAlias && name !== alias);
  entries.push([alias, target]);
  return sortedAliases(entries);
}

export function removeModelAlias(
  aliases: Readonly<Record<string, string>>,
  alias: string,
): Record<string, string> {
  return sortedAliases(Object.entries(aliases).filter(([name]) => name !== alias));
}

export function modelAliasesPutBody(aliases: Readonly<Record<string, string>>): {
  aliases: Record<string, string>;
} {
  return { aliases: sortedAliases(Object.entries(aliases)) };
}

/** Raw provider/model targets for suggestions; callers may still enter an undiscovered model. */
export function modelAliasTargetOptions(models: readonly ModelRow[]): string[] {
  const targets = new Set<string>();
  for (const model of models) {
    if (model.provider === "combo") continue;
    if (model.native === true && model.id.includes("/")) continue;
    if (!model.provider || !model.id) continue;
    targets.add(`${model.provider}/${model.id}`);
  }
  return [...targets].sort();
}
