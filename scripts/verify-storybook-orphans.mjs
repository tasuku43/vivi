import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const currentScriptPath = path.resolve(process.argv[1] ?? "");
const thisScriptPath = path.resolve(new URL(import.meta.url).pathname);

if (currentScriptPath === thisScriptPath) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const orphans = findStorybookOrphans(root);

  if (orphans.length) {
    console.error(
      [
        "Storybook-only product source detected:",
        ...orphans.map((file) => `  - ${file}`),
        "",
        "Either wire these files into the production UI or delete the orphan story surface with its source.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log("storybook orphan check passed");
}

export function findStorybookOrphans(root) {
  const uiSrc = path.join(root, "ui", "src");
  const productionRoots = [path.join(uiSrc, "main.tsx")];
  const sourceFiles = collectSourceFiles(uiSrc);
  const graph = buildImportGraph(sourceFiles);
  const storybookRoots = sourceFiles.filter(isStorybookRoot);
  const productionReachable = reachableFrom(productionRoots, graph);
  const storybookReachable = reachableFrom(storybookRoots, graph);
  return sourceFiles
    .filter((file) => isProductSource(file, uiSrc))
    .filter((file) => storybookReachable.has(file))
    .filter((file) => !productionReachable.has(file))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();
}

export function collectSourceFiles(directory) {
  return Array.from(walk(directory))
    .filter((file) => /\.(tsx?|jsx?)$/.test(file))
    .filter((file) => !file.endsWith(".d.ts"))
    .map((file) => path.resolve(file));
}

export function buildImportGraph(files) {
  const fileSet = new Set(files);
  const graph = new Map(files.map((file) => [file, []]));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") || file.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS,
    );
    const imports = [];
    visitImportSpecifiers(ast, (specifier) => {
      const resolved = resolveImport(file, specifier, fileSet);
      if (resolved) imports.push(resolved);
    });
    graph.set(file, imports);
  }
  return graph;
}

export function reachableFrom(roots, graph) {
  const seen = new Set();
  const stack = roots.map((file) => path.resolve(file));
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file) || !graph.has(file)) continue;
    seen.add(file);
    for (const next of graph.get(file) ?? []) stack.push(next);
  }
  return seen;
}

function isStorybookRoot(file) {
  const normalized = file.split(path.sep).join("/");
  return (
    normalized.endsWith(".stories.tsx") ||
    normalized.endsWith(".stories.ts") ||
    normalized.includes("/ui/src/storybook/")
  );
}

function isProductSource(file, uiSrc) {
  const normalized = file.split(path.sep).join("/");
  return (
    normalized.startsWith(uiSrc.split(path.sep).join("/") + "/") &&
    !isStorybookRoot(file) &&
    !normalized.endsWith(".test.ts") &&
    !normalized.endsWith(".test.tsx") &&
    !normalized.endsWith(".violation.ts") &&
    !normalized.endsWith(".violation.tsx")
  );
}

function visitImportSpecifiers(node, callback) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    callback(node.moduleSpecifier.text);
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    callback(node.arguments[0].text);
  }
  ts.forEachChild(node, (child) => visitImportSpecifiers(child, callback));
}

function resolveImport(fromFile, specifier, fileSet) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of importCandidates(base)) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function importCandidates(base) {
  const extension = path.extname(base);
  const sourceBase =
    extension === ".js" || extension === ".jsx"
      ? base.slice(0, -extension.length)
      : base;
  return [
    base,
    sourceBase,
    `${sourceBase}.ts`,
    `${sourceBase}.tsx`,
    `${sourceBase}.js`,
    `${sourceBase}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(sourceBase, "index.ts"),
    path.join(sourceBase, "index.tsx"),
    path.join(sourceBase, "index.js"),
    path.join(sourceBase, "index.jsx"),
  ].map((file) => path.resolve(file));
}

function* walk(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) yield* walk(full);
    else yield full;
  }
}
