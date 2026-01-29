package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// GlobalConfig stores global CLI configuration (auth tokens, etc.)
type GlobalConfig struct {
	AccessToken string `json:"access_token,omitempty"`
}

// GetConfigDir returns the path to the CLI config directory
func GetConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(home, ".supabase-dx"), nil
}

// GetConfigPath returns the path to the global config file
func GetConfigPath() (string, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// Load reads the global config from disk
func Load() (*GlobalConfig, error) {
	path, err := GetConfigPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &GlobalConfig{}, nil
		}
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var cfg GlobalConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	return &cfg, nil
}

// Save writes the global config to disk
func Save(cfg *GlobalConfig) error {
	dir, err := GetConfigDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	path, err := GetConfigPath()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize config: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	return nil
}

// GetAccessToken returns the stored access token
func GetAccessToken() (string, error) {
	// First check environment variable
	if token := os.Getenv("SUPABASE_ACCESS_TOKEN"); token != "" {
		return token, nil
	}

	cfg, err := Load()
	if err != nil {
		return "", err
	}

	if cfg.AccessToken == "" {
		return "", fmt.Errorf("not logged in. Run 'supa login' first or set SUPABASE_ACCESS_TOKEN")
	}

	return cfg.AccessToken, nil
}
