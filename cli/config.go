package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/tasuku43/vivi/server/workspace"
)

const (
	globalConfigEnvironment  = "VIVI_CONFIG"
	xdgConfigHomeEnvironment = "XDG_CONFIG_HOME"
)

type globalConfig struct {
	Exclude []string `json:"exclude"`
}

func configuredExcludePatterns(cliPatterns []string) ([]string, error) {
	configPath, explicit, err := globalConfigPath()
	if err != nil {
		return nil, err
	}
	config, err := loadGlobalConfig(configPath, explicit)
	if err != nil {
		return nil, fmt.Errorf("load global config %q: %w", configPath, err)
	}
	if _, err := workspace.NewPathExcluder(config.Exclude); err != nil {
		return nil, fmt.Errorf("load global config %q: %w", configPath, err)
	}

	patterns := make([]string, 0, len(config.Exclude)+len(cliPatterns))
	patterns = append(patterns, config.Exclude...)
	patterns = append(patterns, cliPatterns...)
	return patterns, nil
}

func globalConfigPath() (path string, explicit bool, err error) {
	if override := strings.TrimSpace(os.Getenv(globalConfigEnvironment)); override != "" {
		return filepath.Clean(override), true, nil
	}
	configDir, err := defaultGlobalConfigDirectory(runtime.GOOS)
	if err != nil {
		return "", false, err
	}
	return filepath.Join(configDir, "vivi", "config.json"), false, nil
}

func defaultGlobalConfigDirectory(goos string) (string, error) {
	if goos != "darwin" && goos != "linux" {
		configDir, err := os.UserConfigDir()
		if err != nil {
			return "", fmt.Errorf("resolve user config directory: %w", err)
		}
		return configDir, nil
	}

	if configDir := strings.TrimSpace(os.Getenv(xdgConfigHomeEnvironment)); configDir != "" {
		if !filepath.IsAbs(configDir) {
			return "", fmt.Errorf("%s must be an absolute path", xdgConfigHomeEnvironment)
		}
		return configDir, nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	return filepath.Join(homeDir, ".config"), nil
}

func loadGlobalConfig(path string, required bool) (globalConfig, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) && !required {
			return globalConfig{}, nil
		}
		if errors.Is(err, os.ErrNotExist) {
			return globalConfig{}, fmt.Errorf("file does not exist")
		}
		return globalConfig{}, err
	}

	var config globalConfig
	if err := json.Unmarshal(contents, &config); err != nil {
		return globalConfig{}, fmt.Errorf("parse JSON: %w", err)
	}
	return config, nil
}
