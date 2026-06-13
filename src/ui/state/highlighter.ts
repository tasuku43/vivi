import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { LanguageRegistration } from "@shikijs/types";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import type { ResolvedTheme } from "./theme.js";

type SupportedLanguage = keyof typeof languageLoaders;

const languageLoaders = {
  bash: () => import("@shikijs/langs/bash"),
  css: () => import("@shikijs/langs/css"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  markdown: () => import("@shikijs/langs/markdown"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
} satisfies Record<string, () => Promise<{ default: LanguageRegistration[] }>>;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<SupportedLanguage>();

export async function highlightCode(
  code: string,
  language: string,
  theme: ResolvedTheme,
): Promise<string> {
  const highlighter = await getHighlighter();
  const lang = isSupportedLanguage(language) ? language : "text";
  if (lang !== "text") await loadLanguage(highlighter, lang);
  return highlighter.codeToHtml(code, {
    lang,
    theme: theme === "light" ? "github-light" : "github-dark",
  });
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDark, githubLight],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

async function loadLanguage(
  highlighter: HighlighterCore,
  language: SupportedLanguage,
): Promise<void> {
  if (loadedLanguages.has(language)) return;
  const registration = await languageLoaders[language]();
  await highlighter.loadLanguage(registration.default);
  loadedLanguages.add(language);
}

function isSupportedLanguage(language: string): language is SupportedLanguage {
  return language in languageLoaders;
}
