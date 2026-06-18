package vivi

import "embed"

// StaticFiles contains the Vite build output after `npm run build`.
//
//go:embed all:dist/ui
var StaticFiles embed.FS

const StaticRoot = "dist/ui"
