// Package pinned holds the web assets embedded into the binary.
package pinned

import "embed"

// Web is the web/ folder: pages, styles, scripts and app icons.
//
//go:embed web
var Web embed.FS

// Changelog is CHANGELOG.md, shown in the app's What's new sheet.
//
//go:embed CHANGELOG.md
var Changelog []byte
