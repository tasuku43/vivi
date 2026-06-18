# Security model

`vivi` is local-first and read-only.

## Defaults

- Bind to `127.0.0.1`.
- Reject root escape attempts.
- Ignore sensitive large directories by default.
- Render HTML in a sandboxed iframe.
- Allow local HTML stylesheets by default for faithful local artifact previews.
- Disable HTML script execution by default.
- Enable HTML script execution only when `--allow-html-scripts` is passed.
- Do not expose remote access by default.

## Path handling

All file APIs accept normalized relative paths only. Absolute paths and `..` root escapes are rejected.

## HTML preview

HTML preview is useful because generated files and examples are often HTML. It is also the riskiest viewer. The default iframe remains sandboxed and served from the selected local root, with scripts blocked by Content Security Policy and iframe sandboxing. Use `--allow-html-scripts` only when intentionally reviewing trusted generated HTML that needs script execution.
