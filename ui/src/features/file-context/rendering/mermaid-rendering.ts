import { hasCustomMermaidStyle } from "../../../domain/mermaid-preview.js";
import { viviMermaidThemeVariables } from "../../../domain/mermaid-theme.js";
import type { ResolvedTheme } from "../../../state/theme.js";

export async function renderMermaidSvg(
  source: string,
  id: string,
  theme: ResolvedTheme,
): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: hasCustomMermaidStyle(source)
      ? theme === "dark"
        ? "dark"
        : "default"
      : "base",
    themeVariables: hasCustomMermaidStyle(source)
      ? undefined
      : viviMermaidThemeVariables(theme),
    flowchart: { htmlLabels: false },
  });
  const { svg } = await mermaid.render(`vivi-${slugForMarker(id)}`, source);
  return sanitizeMermaidSvg(svg);
}

export function renderMermaidBlocks(
  root: HTMLElement,
  theme: ResolvedTheme,
): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("[data-mermaid-source]"),
  );

  for (const [index, block] of blocks.entries()) {
    const source = block.dataset.mermaidSource;
    const target = block.querySelector<HTMLElement>(".mermaid-render-target");
    if (!source || !target) continue;
    if (block.dataset.mermaidStatus === "loading") continue;
    if (
      block.dataset.mermaidStatus === "rendered" &&
      block.dataset.mermaidTheme === theme
    ) {
      continue;
    }

    block.dataset.mermaidStatus = "loading";
    block.dataset.mermaidTheme = theme;
    target.replaceChildren();
    renderMermaidSvg(
      source,
      `${block.id || "markdown-mermaid"}-${index}-${hashString(source)}`,
      theme,
    )
      .then((svg) => {
        target.innerHTML = svg;
        block.dataset.mermaidStatus = "rendered";
      })
      .catch(() => {
        block.dataset.mermaidStatus = "fallback";
      });
  }
}

export function slugForMarker(value: string): string {
  const slug = value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  return slug || "diagram";
}

export function mermaidRenderId(id: string, source: string): string {
  return `${id}-${hashString(source)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function sanitizeMermaidSvg(svg: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(svg, "image/svg+xml");
  for (const node of Array.from(document.querySelectorAll("script"))) {
    node.remove();
  }
  for (const node of Array.from(document.querySelectorAll("foreignObject"))) {
    node.remove();
  }
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (
        (name === "href" || name.endsWith(":href")) &&
        !isSafeSvgReference(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function isSafeSvgReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return true;
  try {
    const parsed = new URL(trimmed, "https://vivi.local/");
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}
