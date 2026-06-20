import { expect, it, vi } from "vitest";
import { installShutdownHandlers } from "../cli/typescript/main.js";

it("closes the server and exits with the signal code on SIGINT", async () => {
  const events = new Map<string, (signal: NodeJS.Signals) => void>();
  const exits: number[] = [];
  let closed = false;

  const cleanup = installShutdownHandlers(
    {
      async close() {
        closed = true;
      },
    },
    {
      on(signal, listener) {
        events.set(signal, listener);
      },
      off(signal) {
        events.delete(signal);
      },
      exit(code) {
        exits.push(code ?? 0);
      },
    },
  );

  events.get("SIGINT")?.("SIGINT");
  await Promise.resolve();
  await Promise.resolve();

  expect(closed).toBe(true);
  expect(exits).toEqual([130]);
  expect(events.has("SIGINT")).toBe(false);
  expect(events.has("SIGTERM")).toBe(false);
  cleanup();
});

it("forces exit on repeated shutdown signals", () => {
  const events = new Map<string, (signal: NodeJS.Signals) => void>();
  const exits: number[] = [];

  installShutdownHandlers(
    {
      async close() {
        await new Promise(() => {});
      },
    },
    {
      on(signal, listener) {
        events.set(signal, listener);
      },
      off(signal) {
        events.delete(signal);
      },
      exit(code) {
        exits.push(code ?? 0);
      },
    },
  );

  events.get("SIGTERM")?.("SIGTERM");
  events.get("SIGTERM")?.("SIGTERM");

  expect(exits).toEqual([143]);
});

it("exits after the shutdown deadline when server close hangs", async () => {
  vi.useFakeTimers();
  try {
    const events = new Map<string, (signal: NodeJS.Signals) => void>();
    const exits: number[] = [];

    installShutdownHandlers(
      {
        async close() {
          await new Promise(() => {});
        },
      },
      {
        on(signal, listener) {
          events.set(signal, listener);
        },
        off(signal) {
          events.delete(signal);
        },
        exit(code) {
          exits.push(code ?? 0);
        },
      },
      25,
    );

    events.get("SIGINT")?.("SIGINT");
    await vi.advanceTimersByTimeAsync(24);
    expect(exits).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(exits).toEqual([130]);
    expect(events.has("SIGINT")).toBe(false);
    expect(events.has("SIGTERM")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
