// Package pinned holds the web assets embedded into the binary.
package pinned

import "embed"

// Web is the web/ folder: pages, styles, scripts and app icons.
//
//go:embed web
var Web embed.FS
