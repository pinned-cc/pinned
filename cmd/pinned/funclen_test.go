package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// maxFuncLines is the longest a function in the code may be, counted from
// its func line to its closing brace. Longer ones are split.
const maxFuncLines = 150

func TestNoFunctionTooLong(t *testing.T) {
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "node_modules" || strings.HasPrefix(d.Name(), ".")) && path != root {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			n := fset.Position(fn.End()).Line - fset.Position(fn.Pos()).Line + 1
			if n > maxFuncLines {
				t.Errorf("%s: %s is %d lines, more than %d", path, fn.Name.Name, n, maxFuncLines)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
