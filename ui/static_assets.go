package uiassets

import "embed"

// StaticFiles contains the Vite build output after `npm run build`.
//
//go:embed all:dist
var StaticFiles embed.FS

const StaticRoot = "dist"
