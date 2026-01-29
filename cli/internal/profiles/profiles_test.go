package profiles

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "supabase-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create supabase directory
	supabaseDir := filepath.Join(tmpDir, "supabase")
	if err := os.MkdirAll(supabaseDir, 0755); err != nil {
		t.Fatalf("failed to create supabase dir: %v", err)
	}

	// Write config file
	configContent := `
[project]
id = "abcdefghijklmnopqrst"

[profiles.local]
mode = "local"
workflow = "dashboard"
branches = ["feature/*", "fix/*"]

[profiles.staging]
mode = "remote"
workflow = "git"
project = "staging-project-ref"
branches = ["staging", "main"]
`
	configPath := filepath.Join(supabaseDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	// Test loading config
	config, err := LoadConfig(tmpDir)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Verify project ID
	if config.Project.ID != "abcdefghijklmnopqrst" {
		t.Errorf("expected project ID 'abcdefghijklmnopqrst', got '%s'", config.Project.ID)
	}

	// Verify profiles
	if len(config.Profiles) != 2 {
		t.Fatalf("expected 2 profiles, got %d", len(config.Profiles))
	}

	local, ok := config.Profiles["local"]
	if !ok {
		t.Fatal("expected 'local' profile")
	}

	if local.Mode != "local" {
		t.Errorf("expected mode 'local', got '%s'", local.Mode)
	}

	if len(local.Branches) != 2 {
		t.Errorf("expected 2 branch patterns, got %d", len(local.Branches))
	}
}

func TestGetProfile(t *testing.T) {
	config := &Config{
		Profiles: map[string]Profile{
			"dev": {
				Mode:     "local",
				Workflow: "dashboard",
			},
			"prod": {
				Mode:     "remote",
				Workflow: "git",
			},
		},
	}

	// Test getting specific profile
	profile, err := config.GetProfile("dev")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if profile.Mode != "local" {
		t.Errorf("expected mode 'local', got '%s'", profile.Mode)
	}

	// Test getting non-existent profile
	_, err = config.GetProfile("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent profile")
	}

	// Test auto-selection (empty name)
	profile, err = config.GetProfile("")
	if err != nil {
		t.Fatalf("expected no error for auto-selection, got %v", err)
	}

	if profile == nil {
		t.Error("expected a profile to be auto-selected")
	}
}

func TestGetProfileForBranch(t *testing.T) {
	config := &Config{
		Profiles: map[string]Profile{
			"local": {
				Mode:     "local",
				Branches: []string{"feature/*", "fix/*"},
			},
			"staging": {
				Mode:     "remote",
				Branches: []string{"staging", "main"},
			},
		},
	}

	tests := []struct {
		branch       string
		expectedName string
	}{
		{"feature/auth", "local"},
		{"fix/bug-123", "local"},
		{"staging", "staging"},
		{"main", "staging"},
		{"random-branch", ""},
	}

	for _, tt := range tests {
		t.Run(tt.branch, func(t *testing.T) {
			profile, name := config.GetProfileForBranch(tt.branch)

			if tt.expectedName == "" {
				if profile != nil {
					t.Errorf("expected no matching profile for branch '%s'", tt.branch)
				}
			} else {
				if name != tt.expectedName {
					t.Errorf("expected profile '%s' for branch '%s', got '%s'", tt.expectedName, tt.branch, name)
				}
			}
		})
	}
}

func TestMatchBranch(t *testing.T) {
	profile := &Profile{
		Branches: []string{"feature/*", "fix/*", "main"},
	}

	tests := []struct {
		branch   string
		expected bool
	}{
		{"feature/auth", true},
		{"feature/login", true},
		{"fix/bug-123", true},
		{"main", true},
		{"develop", false},
		{"staging", false},
		{"feat/something", false},
	}

	for _, tt := range tests {
		t.Run(tt.branch, func(t *testing.T) {
			result := profile.MatchBranch(tt.branch)
			if result != tt.expected {
				t.Errorf("MatchBranch(%s) = %v, expected %v", tt.branch, result, tt.expected)
			}
		})
	}
}

func TestGetProjectRef(t *testing.T) {
	config := &Config{}
	config.Project.ID = "default-project-ref"

	// Profile without explicit project
	profile := &Profile{
		Mode: "local",
	}

	ref := profile.GetProjectRef(config)
	if ref != "default-project-ref" {
		t.Errorf("expected default project ref, got '%s'", ref)
	}

	// Profile with explicit project
	profile.Project = "override-project-ref"
	ref = profile.GetProjectRef(config)
	if ref != "override-project-ref" {
		t.Errorf("expected override project ref, got '%s'", ref)
	}
}

func TestListProfileNames(t *testing.T) {
	config := &Config{
		Profiles: map[string]Profile{
			"dev":     {},
			"staging": {},
			"prod":    {},
		},
	}

	names := config.ListProfileNames()
	if len(names) != 3 {
		t.Errorf("expected 3 profile names, got %d", len(names))
	}

	// Check all names are present (order doesn't matter)
	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}

	for _, expected := range []string{"dev", "staging", "prod"} {
		if !nameSet[expected] {
			t.Errorf("expected profile name '%s' in list", expected)
		}
	}
}
