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

func TestGlobalConfigPathPrefersExplicitViviConfig(t *testing.T) {
	explicitPath := filepath.Join(t.TempDir(), "explicit.json")
	t.Setenv(globalConfigEnvironment, explicitPath)
	t.Setenv(xdgConfigHomeEnvironment, t.TempDir())

	path, explicit, err := globalConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if path != explicitPath || !explicit {
		t.Fatalf("global config path = %q explicit=%v, want %q explicit=true", path, explicit, explicitPath)
	}
}

func TestGlobalConfigPathUsesXDGConfigHome(t *testing.T) {
	configHome := t.TempDir()
	t.Setenv(globalConfigEnvironment, "")
	t.Setenv(xdgConfigHomeEnvironment, configHome)

	path, explicit, err := globalConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(configHome, "vivi", "config.json")
	if path != want || explicit {
		t.Fatalf("global config path = %q explicit=%v, want %q explicit=false", path, explicit, want)
	}
}

func TestGlobalConfigPathDefaultsToHomeDotConfig(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv(globalConfigEnvironment, "")
	t.Setenv(xdgConfigHomeEnvironment, "")
	t.Setenv("HOME", homeDir)

	path, explicit, err := globalConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(homeDir, ".config", "vivi", "config.json")
	if path != want || explicit {
		t.Fatalf("global config path = %q explicit=%v, want %q explicit=false", path, explicit, want)
	}
}

func TestGlobalConfigPathRejectsRelativeXDGConfigHome(t *testing.T) {
	t.Setenv(globalConfigEnvironment, "")
	t.Setenv(xdgConfigHomeEnvironment, "relative-config")

	_, _, err := globalConfigPath()
	if err == nil || !strings.Contains(err.Error(), "XDG_CONFIG_HOME must be an absolute path") {
		t.Fatalf("expected relative XDG_CONFIG_HOME error, got %v", err)
	}
}

func TestConfiguredExcludePatternsFollowsDotConfigSymlink(t *testing.T) {
	homeDir := t.TempDir()
	configTarget := t.TempDir()
	configDir := filepath.Join(configTarget, "vivi")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.json"), []byte(`{"exclude":["config.yaml"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(configTarget, filepath.Join(homeDir, ".config")); err != nil {
		t.Skipf("create .config symlink: %v", err)
	}
	t.Setenv(globalConfigEnvironment, "")
	t.Setenv(xdgConfigHomeEnvironment, "")
	t.Setenv("HOME", homeDir)

	patterns, err := configuredExcludePatterns(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(patterns) != 1 || patterns[0] != "config.yaml" {
		t.Fatalf("patterns through .config symlink = %#v", patterns)
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
