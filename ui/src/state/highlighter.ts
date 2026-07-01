import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { LanguageRegistration } from "@shikijs/types";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import lightPlus from "@shikijs/themes/light-plus";
import type { ResolvedTheme } from "./theme.js";

type SupportedLanguage = keyof typeof languageLoaders;

const languageLoaders = {
  asm: () => import("@shikijs/langs/asm"),
  awk: () => import("@shikijs/langs/awk"),
  bash: () => import("@shikijs/langs/bash"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  css: () => import("@shikijs/langs/css"),
  csv: () => import("@shikijs/langs/csv"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/docker"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  log: () => import("@shikijs/langs/log"),
  lua: () => import("@shikijs/langs/lua"),
  makefile: () => import("@shikijs/langs/make"),
  markdown: () => import("@shikijs/langs/markdown"),
  mermaid: () => import("@shikijs/langs/mmd"),
  perl: () => import("@shikijs/langs/perl"),
  php: () => import("@shikijs/langs/php"),
  properties: () => import("@shikijs/langs/properties"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  toml: () => import("@shikijs/langs/toml"),
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
    theme: shikiThemeForLanguage(lang, theme),
  });
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDark, githubLight, lightPlus],
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

function shikiThemeForLanguage(
  language: SupportedLanguage | "text",
  theme: ResolvedTheme,
): string {
  if (language === "html" || language === "xml") {
    return theme === "light" ? "light-plus" : "github-dark";
  }
  return theme === "light" ? "github-light" : "github-dark";
}
