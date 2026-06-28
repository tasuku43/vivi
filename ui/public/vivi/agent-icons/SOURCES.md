# Agent Icon Sources

These local UI assets identify comment-thread actors. Official brand assets are used only when they come from a brand/asset page or a documented brand guideline asset. We do not use favicon files, page-title logos, or logos scraped from arbitrary web chrome as product icons.

## Official Assets

- `codex.svg`
  - Source page: `https://openai.com/ja-JP/brand/`
  - Source asset: `https://images.ctfassets.net/kftzwdyauwt9/3hUGLn3ypllZ0oa01qOYVq/28e8188e6f11b84c3e876569d492734f/Blossom_Light.svg`
  - Used for the Codex actor identity as OpenAI's official Blossom mark. The local SVG uses the provided Blossom geometry, narrows the viewBox to the mark, and renders the mark in white for Vivi's dark comment UI so the small avatar does not shrink the full spacing-guide artboard into a tiny icon.
- `cursor.svg`
  - Source page: `https://cursor.com/brand`
  - Source asset: `https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/brand-logo-10.svg`
  - Local SVG keeps the official paths and narrows the viewBox to the square app mark area so it remains legible as a small comment avatar.
- `windsurf.svg`
  - Source page: `https://windsurf.com/brand`
  - Source asset: `https://exafunction.github.io/public/brand/windsurf-white-symbol.svg`
- `github-copilot.svg`
  - Source page: `https://primer.style/octicons/icon/copilot-24/`
  - Source asset: `https://raw.githubusercontent.com/primer/octicons/main/icons/copilot-24.svg`
  - Used for the GitHub Copilot actor identity with GitHub's official Primer Octicons `copilot-24` icon. The local SVG keeps the official Octicon paths and renders them in white for Vivi's dark comment UI.
  - GitHub's Copilot brand page at `https://brand.github.com/brand-identity/copilot` says that beginning in 2025, GitHub Copilot no longer has a standalone logo that heros the Copilot icon.
  - GitHub's mascot page at `https://brand.github.com/graphic-elements/mascots` says public-facing mascot usage must be approved by GitHub's Brand & Marketing Design team and that mascots should not be used as logos or product branding. For that reason, Vivi does not crop or ship the Copilot mascot image as a UI avatar.

## Local Fallback Badges

- `claude-code.svg`
  - Local fallback badge. Anthropic has official Brandfolder assets at `https://brandfolder.com/anthropic/newsroom`, but no compact Claude Code-specific icon was used here.
- `devin.svg`
  - Local fallback badge. Cognition's brand page at `https://old.cognition.ai/brand` provides Devin lockups, but no compact icon asset was used here.
- `human.svg`
  - Local fallback badge for human authors. This is a Vivi-drawn silhouette badge, not an external brand asset.
- `unknown.svg`
  - Local fallback badge for unknown actors.
