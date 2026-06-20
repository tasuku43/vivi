# Viewer Extension Guide

Use this when adding a new file viewer without turning vivi into an editor.

1. Classify the UI concept in `ui/src/domain/viewer-kind.ts`.
2. Keep filesystem reads in `server/`; return the existing `FilePayload` contract.
3. Add a browser-only React viewer in `ui/src/features/file-context/viewers/`.
4. Dispatch it from `ui/src/features/file-context/components/FileViewer.tsx`.
5. Add a focused unit or component test.
6. Update `evals/cases/basic-tree.json` when the new viewer affects product coverage.
7. Keep the viewer read-only and safe by default. If script execution is involved, make it explicit in CLI/config/UI/README.

Current examples:

- `JsonViewer`: tree/source for structured data.
- `CsvViewer`: bounded table/source for generated reports.
- `MermaidViewer`: lightweight safe flowchart preview/source.
