package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfiguredExcludePatternsMergeGlobalConfigAndCLI(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(configPath, []byte(`{
  "exclude": ["package-lock.json", "**/generated/**"]
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(globalConfigEnvironment, configPath)

	patterns, err := configuredExcludePatterns([]string{"snapshots/"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"package-lock.json", "**/generated/**", "snapshots/"}
	if len(patterns) != len(want) {
		t.Fatalf("patterns = %#v, want %#v", patterns, want)
	}
	for index := range want {
		if patterns[index] != want[index] {
			t.Fatalf("patterns = %#v, want %#v", patterns, want)
		}
	}
}

func TestConfiguredExcludePatternsRejectInvalidGlobalGlob(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(configPath, []byte(`{"exclude":["../private/**"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(globalConfigEnvironment, configPath)

	_, err := configuredExcludePatterns(nil)
	if err == nil || !strings.Contains(err.Error(), configPath) || !strings.Contains(err.Error(), "parent segments are not allowed") {
		t.Fatalf("expected config path and invalid glob error, got %v", err)
	}
}

func TestLoadGlobalConfigAllowsMissingDefaultFile(t *testing.T) {
	config, err := loadGlobalConfig(filepath.Join(t.TempDir(), "missing.json"), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(config.Exclude) != 0 {
		t.Fatalf("expected empty config, got %#v", config)
	}
}

func TestLoadGlobalConfigRejectsMissingExplicitFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "missing.json")
	_, err := loadGlobalConfig(configPath, true)
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected missing explicit config error, got %v", err)
	}
}

func TestLoadGlobalConfigRejectsMalformedJSON(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(configPath, []byte(`{"exclude":`), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := loadGlobalConfig(configPath, true)
	if err == nil || !strings.Contains(err.Error(), "parse JSON") {
		t.Fatalf("expected malformed JSON error, got %v", err)
	}
}
