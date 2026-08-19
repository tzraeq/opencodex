import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { LanguageProvider } from "../src/i18n/provider";
import { ModelAliasesPanel } from "../src/pages/model-aliases-panel";

const globals = ["document", "window", "navigator", "localStorage", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previousDescriptors: Record<(typeof globals)[number], PropertyDescriptor | undefined>;
let testWindow: Window;
let originalFetch: typeof fetch;

beforeEach(() => {
  previousDescriptors = Object.fromEntries(
    globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  ) as typeof previousDescriptors;
  originalFetch = globalThis.fetch;
  testWindow = new Window({ url: "http://localhost/#models" });
  Object.defineProperty(testWindow.navigator, "language", { configurable: true, value: "en-US" });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
    localStorage: { configurable: true, value: testWindow.localStorage },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  testWindow.close();
  for (const key of globals) {
    const descriptor = previousDescriptors[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(testWindow.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await new Promise<void>(resolve => testWindow.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

test("adds an alias with a complete replacement PUT and renders the returned map", async () => {
  const puts: Array<{ aliases: Record<string, string> }> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "PUT") {
      const body = JSON.parse(String(init?.body)) as { aliases: Record<string, string> };
      puts.push(body);
      return Response.json({ ok: true, aliases: body.aliases });
    }
    return Response.json({ aliases: { existing: "acode/old" } });
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LanguageProvider>
        <ModelAliasesPanel
          apiBase="http://localhost"
          models={[{ provider: "acode", id: "kimi-k3", namespaced: "acode/kimi-k3", disabled: false }]}
        />
      </LanguageProvider>,
    );
  });
  await flush();

  const add = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.trim() === "Add alias")!;
  await act(async () => { add.click(); });

  const aliasInput = container.querySelector<HTMLInputElement>('input[placeholder="e.g. gpt-5.6-sol"]')!;
  const targetInput = container.querySelector<HTMLInputElement>('input[placeholder="e.g. acode/kimi-k3"]')!;
  await act(async () => {
    setInputValue(aliasInput, "gpt-5.6-sol");
    setInputValue(targetInput, "acode/kimi-k3");
  });
  const save = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.trim() === "Save")!;
  await act(async () => { save.click(); });
  await flush();

  expect(puts).toEqual([{ aliases: { existing: "acode/old", "gpt-5.6-sol": "acode/kimi-k3" } }]);
  expect(container.textContent).toContain("gpt-5.6-sol");
  expect(container.textContent).toContain("acode/kimi-k3");

  await act(async () => root.unmount());
  container.remove();
});

test("keeps all mutations disabled until a failed initial load is retried successfully", async () => {
  let getCount = 0;
  let putCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "PUT") {
      putCount += 1;
      return Response.json({ ok: true, aliases: {} });
    }
    getCount += 1;
    if (getCount === 1) return Response.json({ error: "unavailable" }, { status: 503 });
    return Response.json({ aliases: { existing: "acode/old" } });
  }) as typeof fetch;

  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LanguageProvider>
        <ModelAliasesPanel apiBase="http://localhost" models={[]} />
      </LanguageProvider>,
    );
  });
  await flush();

  const add = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.trim() === "Add alias")!;
  expect(add.disabled).toBe(true);
  await act(async () => { add.click(); });
  expect(container.querySelector("form")).toBeNull();
  expect(putCount).toBe(0);

  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.trim() === "Retry")!;
  await act(async () => { retry.click(); });
  await flush();

  expect(getCount).toBe(2);
  expect(add.disabled).toBe(false);
  expect(container.textContent).toContain("existing");
  expect(putCount).toBe(0);

  await act(async () => root.unmount());
  container.remove();
});
