package server_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerPackageDependencyBoundaries(t *testing.T) {
	rules := []struct {
		name, directory, forbidden string
		shallow                    bool
	}{
		{"graphql_to_http", "graphql", "github.com/tasuku43/vivi/server/http", false},
		{"http_to_graphql", "http", "github.com/tasuku43/vivi/server/graphql", false},
		{"application_to_http", "application", "github.com/tasuku43/vivi/server/http", false},
		{"application_to_graphql", "application", "github.com/tasuku43/vivi/server/graphql", false},
		{"server_to_cli", ".", "github.com/tasuku43/vivi/cli", true},
	}
	for _, rule := range rules {
		t.Run(rule.name, func(t *testing.T) {
			assertNoGoImport(t, rule.directory, rule.forbidden, rule.shallow)
		})
	}
}

func assertNoGoImport(t *testing.T, directory, forbidden string, shallow bool) {
	t.Helper()
	if _, err := os.Stat(directory); os.IsNotExist(err) {
		return
	}
	err := filepath.WalkDir(directory, func(file string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Name() == "architecture_boundary_test.go" {
			return nil
		}
		if entry.IsDir() && shallow && file != directory {
			return filepath.SkipDir
		}
		if entry.IsDir() || filepath.Ext(file) != ".go" {
			return nil
		}
		source, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		if strings.Contains(string(source), forbidden) {
			t.Errorf("forbidden package dependency %s in %s", forbidden, file)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
