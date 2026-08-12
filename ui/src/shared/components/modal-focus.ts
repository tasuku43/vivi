import type { KeyboardEvent } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusModalEntry(
  container: HTMLElement | null,
  preferred?: HTMLElement | null,
): void {
  window.requestAnimationFrame(() => {
    if (preferred?.isConnected) {
      preferred.focus();
      return;
    }
    focusableModalElements(container)[0]?.focus();
  });
}

export function trapModalTab(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
): void {
  if (event.key !== "Tab") return;
  const focusable = focusableModalElements(container);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container?.contains(active))) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && (active === last || !container?.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function restoreModalFocus(element: HTMLElement | null): void {
  if (!element?.isConnected) return;
  window.requestAnimationFrame(() => element.focus());
}

function focusableModalElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.getAttribute("aria-hidden") !== "true")
    .filter((element) => element.getClientRects().length > 0);
}
