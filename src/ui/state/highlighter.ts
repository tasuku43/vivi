import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "@shikijs/themes/github-dark";
import bash from "@shikijs/langs/bash";
import css from "@shikijs/langs/css";
import go from "@shikijs/langs/go";
import html from "@shikijs/langs/html";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsonc from "@shikijs/langs/jsonc";
import jsx from "@shikijs/langs/jsx";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import rust from "@shikijs/langs/rust";
import scss from "@shikijs/langs/scss";
import sql from "@shikijs/langs/sql";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";

const supportedLanguages = new Set([
  "bash",
  "css",
  "go",
  "html",
  "javascript",
  "json",
  "jsonc",
  "jsx",
  "markdown",
  "python",
  "rust",
  "scss",
  "sql",
  "tsx",
  "typescript",
  "xml",
  "yaml",
]);

let highlighterPromise: Promise<HighlighterCore> | null = null;

export async function highlightCode(
  code: string,
  language: string,
): Promise<string> {
  const highlighter = await getHighlighter();
  const lang = supportedLanguages.has(language) ? language : "text";
  return highlighter.codeToHtml(code, {
    lang,
    theme: "github-dark",
  });
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDark],
    langs: [
      bash,
      css,
      go,
      html,
      javascript,
      json,
      jsonc,
      jsx,
      markdown,
      python,
      rust,
      scss,
      sql,
      tsx,
      typescript,
      xml,
      yaml,
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}
