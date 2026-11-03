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

// ThirdPartyNotices is THIRD_PARTY_NOTICES: the licence files of every Go
// module built into the binary and of Go itself, printed by -licenses.
// TestThirdPartyNoticesCoverGoMod fails when it falls behind go.mod.
//
//go:generate go run ./tools/notices
//go:embed THIRD_PARTY_NOTICES
var ThirdPartyNotices []byte
