// Command notices writes THIRD_PARTY_NOTICES: the licence files of every Go
// module built into pinned and of Go itself, which `pinned -licenses` prints.
//
// Run it from the repository root after any change to go.mod:
//
//	go run ./tools/notices
//
// The module set is every module `go list -deps ./cmd/pinned` names for the
// platforms the binary is built for, together with every module go.mod
// requires. Licence files are read from each module's root folder in the
// module cache (go mod download fills it), Go's own from GOROOT. The output
// depends only on the module versions, so running it again gives the same
// file; TestThirdPartyNoticesCoverGoMod fails when go.mod and the file part.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// platforms are the targets of the release image and of a build on a Mac.
var platforms = []string{"linux/amd64", "linux/arm64", "darwin/arm64", "darwin/amd64"}

type module struct {
	Path, Version, Dir string
	Main               bool
}

func main() {
	out := "THIRD_PARTY_NOTICES"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	data, err := build()
	if err != nil {
		fmt.Fprintln(os.Stderr, "notices:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(out, data, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "notices:", err)
		os.Exit(1)
	}
}

func build() ([]byte, error) {
	mods := map[string]module{}
	for _, p := range platforms {
		goos, goarch, _ := strings.Cut(p, "/")
		list, err := goList([]string{"GOOS=" + goos, "GOARCH=" + goarch, "CGO_ENABLED=0"},
			"list", "-deps", "-f", "{{with .Module}}{{if not .Main}}{{.Path}}@{{.Version}}{{end}}{{end}}", "./cmd/pinned")
		if err != nil {
			return nil, err
		}
		for _, line := range strings.Fields(list) {
			path, _, _ := strings.Cut(line, "@")
			mods[path] = module{}
		}
	}
	// go.mod's own requirements, so the file and go.mod cannot part.
	gomod, err := goList(nil, "mod", "edit", "-json")
	if err != nil {
		return nil, err
	}
	var mf struct{ Require []struct{ Path string } }
	if err := json.Unmarshal([]byte(gomod), &mf); err != nil {
		return nil, err
	}
	for _, r := range mf.Require {
		mods[r.Path] = module{}
	}
	paths := make([]string, 0, len(mods))
	for p := range mods {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	// One go list -m resolves version and cache folder, downloading if needed.
	js, err := goList(nil, append([]string{"list", "-m", "-json"}, paths...)...)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(strings.NewReader(js))
	var resolved []module
	for dec.More() {
		var m module
		if err := dec.Decode(&m); err != nil {
			return nil, err
		}
		if m.Dir == "" {
			if _, err := goList(nil, "mod", "download", m.Path+"@"+m.Version); err != nil {
				return nil, err
			}
			dir, err := goList(nil, "list", "-m", "-f", "{{.Dir}}", m.Path)
			if err != nil {
				return nil, err
			}
			m.Dir = strings.TrimSpace(dir)
		}
		resolved = append(resolved, m)
	}
	sort.Slice(resolved, func(i, j int) bool { return resolved[i].Path < resolved[j].Path })

	var b bytes.Buffer
	b.WriteString("Licence notices of the Go modules built into Pinned and of Go itself.\n")
	b.WriteString("Written by `go run ./tools/notices` from go.mod and the module cache. Do not edit by hand.\n")
	goroot, err := goList(nil, "env", "GOROOT")
	if err != nil {
		return nil, err
	}
	if err := goSection(&b, strings.TrimSpace(goroot)); err != nil {
		return nil, err
	}
	for _, m := range resolved {
		if err := section(&b, m.Path+" "+m.Version, m.Dir); err != nil {
			return nil, err
		}
	}
	return b.Bytes(), nil
}

// goSection writes Go's LICENSE and PATENTS from GOROOT. Homebrew moves
// LICENSE one folder up, next to libexec, so it is looked for there too.
func goSection(b *bytes.Buffer, goroot string) error {
	var files []string
	for _, name := range []string{"LICENSE", "PATENTS"} {
		for _, dir := range []string{goroot, filepath.Dir(goroot)} {
			if path := filepath.Join(dir, name); fileExists(path) {
				files = append(files, path)
				break
			}
		}
	}
	if len(files) == 0 || filepath.Base(files[0]) != "LICENSE" {
		return fmt.Errorf("go's LICENSE is not in %s", goroot)
	}
	return write(b, "Go (the Go toolchain, runtime and standard library)", files)
}

func fileExists(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.Mode().IsRegular()
}

// section writes a heading and every licence file in the root of dir. A
// module without one is an error: its terms must be looked at by hand.
func section(b *bytes.Buffer, title, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		up := strings.ToUpper(e.Name())
		for _, p := range []string{"LICENSE", "LICENCE", "COPYING", "COPYRIGHT", "NOTICE", "PATENTS", "UNLICENSE"} {
			if strings.HasPrefix(up, p) {
				files = append(files, filepath.Join(dir, e.Name()))
				break
			}
		}
	}
	if len(files) == 0 {
		return fmt.Errorf("%s: no licence file in %s", title, dir)
	}
	sort.Strings(files)
	return write(b, title, files)
}

// write writes a heading and the files under it, each under its base name.
func write(b *bytes.Buffer, title string, files []string) error {
	fmt.Fprintf(b, "\n== %s ==\n", title)
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
		fmt.Fprintf(b, "\n-- %s --\n\n%s", filepath.Base(f), data)
		if !bytes.HasSuffix(data, []byte("\n")) {
			b.WriteByte('\n')
		}
	}
	return nil
}

// goList runs the go command with extra environment and returns its output.
func goList(env []string, args ...string) (string, error) {
	cmd := exec.Command("go", args...)
	cmd.Env = append(os.Environ(), env...)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("go %s: %w", strings.Join(args, " "), err)
	}
	return string(out), nil
}
