import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createBoundedFetch } from "../bounded-fetch";
import { readJsonOrThrow } from "../fetch-json";
import { IconChevron, IconLink, IconPencil, IconPlus, IconTrash } from "../icons";
import { useT } from "../i18n/shared";
import {
  isModelAliasName,
  isModelAliasTarget,
  modelAliasesPutBody,
  modelAliasTargetOptions,
  removeModelAlias,
  upsertModelAlias,
} from "../model-aliases";
import type { ModelRow } from "./models-shared";

interface ModelAliasesResponse {
  aliases?: Record<string, string>;
}

interface AliasEditor {
  originalAlias: string | null;
  alias: string;
  target: string;
}

export function ModelAliasesPanel({ apiBase, models }: { apiBase: string; models: readonly ModelRow[] }) {
  const t = useT();
  const aliasInputId = useId();
  const targetInputId = useId();
  const targetListId = useId();
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<AliasEditor | null>(null);
  const mountedRef = useRef(true);
  const mutationRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const bounded = createBoundedFetch(15_000);
    void fetch(`${apiBase}/api/model-aliases`, { signal: bounded.signal })
      .then(response => readJsonOrThrow<ModelAliasesResponse>(response, t("models.aliases.loadFailed")))
      .then(data => {
        if (bounded.signal.aborted || !mountedRef.current) return;
        setLoadFailed(false);
        setError("");
        setAliases(data?.aliases ?? {});
      })
      .catch(() => {
        if (!bounded.signal.aborted && mountedRef.current) {
          setLoadFailed(true);
          setError(t("models.aliases.loadFailed"));
        }
      })
      .finally(() => {
        bounded.clear();
        if (!bounded.signal.aborted && mountedRef.current) setLoading(false);
      });
    return () => {
      bounded.controller.abort();
      bounded.clear();
    };
  }, [apiBase, loadGeneration, t]);

  const targetOptions = useMemo(() => modelAliasTargetOptions(models), [models]);
  const aliasEntries = useMemo(() => Object.entries(aliases), [aliases]);

  const persistAliases = async (next: Record<string, string>): Promise<boolean> => {
    if (loading || loadFailed) return false;
    const bounded = createBoundedFetch(15_000);
    mutationRef.current = bounded.controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/model-aliases`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(modelAliasesPutBody(next)),
        signal: bounded.signal,
      });
      const data = await readJsonOrThrow<ModelAliasesResponse>(response, t("models.aliases.saveFailed"));
      if (bounded.signal.aborted || !mountedRef.current) return false;
      setAliases(data?.aliases ?? next);
      return true;
    } catch (saveError) {
      if (!bounded.signal.aborted && mountedRef.current) {
        setError(saveError instanceof Error ? saveError.message : t("models.aliases.saveFailed"));
      }
      return false;
    } finally {
      bounded.clear();
      if (mutationRef.current === bounded.controller) mutationRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  };

  const saveEditor = async () => {
    if (!editor || loading || loadFailed) return;
    const alias = editor.alias.trim();
    const target = editor.target.trim();
    if (!isModelAliasName(alias)) {
      setError(t("models.aliases.invalidAlias"));
      return;
    }
    if (!isModelAliasTarget(target)) {
      setError(t("models.aliases.invalidTarget"));
      return;
    }
    if (alias !== editor.originalAlias && Object.hasOwn(aliases, alias)) {
      setError(t("models.aliases.duplicate"));
      return;
    }
    if (await persistAliases(upsertModelAlias(aliases, editor.originalAlias, alias, target))) {
      setEditor(null);
    }
  };

  const deleteAlias = async (alias: string) => {
    if (loading || loadFailed) return;
    if (!window.confirm(t("models.aliases.deleteConfirm", { alias }))) return;
    if (await persistAliases(removeModelAlias(aliases, alias))) {
      setEditor(current => current?.originalAlias === alias ? null : current);
    }
  };

  return (
    <section className="model-aliases-panel" aria-labelledby="model-aliases-title">
      <div className="model-aliases-header">
        <div className="model-aliases-heading">
          <IconLink aria-hidden="true" />
          <h3 id="model-aliases-title">{t("models.aliases.title")}</h3>
          {!loading && <span className="model-aliases-count">{aliasEntries.length}</span>}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setError("");
            setEditor({ originalAlias: null, alias: "", target: "" });
          }}
          disabled={loading || loadFailed || busy || editor !== null}
        >
          <IconPlus aria-hidden="true" />
          {t("models.aliases.add")}
        </button>
      </div>

      {error && (
        <div className="model-aliases-message" role="alert">
          <span>{error}</span>
          {loadFailed && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setLoading(true);
                setLoadFailed(false);
                setError("");
                setLoadGeneration(value => value + 1);
              }}
            >
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="model-aliases-empty">{t("common.loading")}</div>
      ) : (
        <div className="model-aliases-list">
          {aliasEntries.map(([alias, target]) => (
            <div className="model-aliases-row" key={alias}>
              <code className="model-aliases-value">{alias}</code>
              <IconChevron className="model-aliases-arrow" aria-hidden="true" />
              <code className="model-aliases-value model-aliases-target">{target}</code>
              <div className="model-aliases-actions">
                <button
                  type="button"
                  className="model-aliases-icon-button"
                  aria-label={t("models.aliases.edit", { alias })}
                  title={t("models.aliases.edit", { alias })}
                  disabled={loading || loadFailed || busy || editor !== null}
                  onClick={() => {
                    setError("");
                    setEditor({ originalAlias: alias, alias, target });
                  }}
                >
                  <IconPencil aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="model-aliases-icon-button model-aliases-icon-button--danger"
                  aria-label={t("models.aliases.delete", { alias })}
                  title={t("models.aliases.delete", { alias })}
                  disabled={loading || loadFailed || busy || editor !== null}
                  onClick={() => { void deleteAlias(alias); }}
                >
                  <IconTrash aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          {aliasEntries.length === 0 && !editor && !error && (
            <div className="model-aliases-empty">{t("models.aliases.empty")}</div>
          )}
        </div>
      )}

      {editor && (
        <form
          className="model-aliases-editor"
          onSubmit={event => {
            event.preventDefault();
            void saveEditor();
          }}
        >
          <label className="model-aliases-field" htmlFor={aliasInputId}>
            <span>{t("models.aliases.alias")}</span>
            <input
              id={aliasInputId}
              className="input"
              value={editor.alias}
              placeholder={t("models.aliases.aliasPlaceholder")}
              autoComplete="off"
              disabled={loading || loadFailed || busy}
              onChange={event => setEditor({ ...editor, alias: event.target.value })}
            />
          </label>
          <label className="model-aliases-field" htmlFor={targetInputId}>
            <span>{t("models.aliases.target")}</span>
            <input
              id={targetInputId}
              className="input"
              list={targetListId}
              value={editor.target}
              placeholder={t("models.aliases.targetPlaceholder")}
              autoComplete="off"
              disabled={loading || loadFailed || busy}
              onChange={event => setEditor({ ...editor, target: event.target.value })}
            />
            <datalist id={targetListId}>
              {targetOptions.map(target => <option value={target} key={target} />)}
            </datalist>
          </label>
          <div className="model-aliases-editor-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEditor(null); setError(""); }}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading || loadFailed || busy}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
