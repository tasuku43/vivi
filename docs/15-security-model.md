# Security model

`pathlens` is local-first and read-only.

## Defaults

- Bind to `127.0.0.1`.
- Reject root escape attempts.
- Ignore sensitive large directories by default.
- Render HTML in a sandboxed iframe.
- Allow local HTML stylesheets and scripts by default for faithful local artifact previews.
- Disable HTML script execution when `--no-html-scripts` is passed.
- Do not expose remote access by default.

## Path handling

All file APIs accept normalized relative paths only. Absolute paths and `..` root escapes are rejected.

## HTML preview

HTML preview is useful because generated files and examples are often HTML. It is also the riskiest viewer. The default iframe remains sandboxed and served from the selected local root, but scripts are enabled by default so generated artifacts behave like they do in a browser. Use `--no-html-scripts` for a stricter preview when inspecting untrusted files.
