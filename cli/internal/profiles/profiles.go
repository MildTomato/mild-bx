package profiles

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/pelletier/go-toml/v2"
)

// Profile defines a development environment configuration
type Profile struct {
	Name     string   `toml:"-"`        // Name is set from the map key
	Mode     string   `toml:"mode"`     // local, preview, remote
	Workflow string   `toml:"workflow"` // git, dashboard
	Schema   string   `toml:"schema"`   // declarative, migrations
	Branches []string `toml:"branches"` // git branch patterns for auto-selection
	Project  string   `toml:"project"`  // Supabase project ref (for remote/preview)
}

// Config represents the ./supabase/config.toml structure
type Config struct {
	Project struct {
		ID string `toml:"id"`
	} `toml:"project"`
	Profiles map[string]Profile `toml:"profiles"`
}

// LoadConfig reads the config from ./supabase/config.toml
func LoadConfig(dir string) (*Config, error) {
	configPath := filepath.Join(dir, "supabase", "config.toml")

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var config Config
	if err := toml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// Set profile names from map keys
	for name, profile := range config.Profiles {
		profile.Name = name
		config.Profiles[name] = profile
	}

	return &config, nil
}

// GetProfile returns a profile by name, or attempts to auto-select based on git branch
func (c *Config) GetProfile(name string) (*Profile, error) {
	if name != "" {
		profile, ok := c.Profiles[name]
		if !ok {
			return nil, fmt.Errorf("profile %q not found", name)
		}
		profile.Name = name
		return &profile, nil
	}

	// Return first profile as default
	for n, p := range c.Profiles {
		profile := p
		profile.Name = n
		return &profile, nil
	}

	return nil, fmt.Errorf("no profiles configured")
}

// GetProfileForBranch finds a profile that matches the given git branch
func (c *Config) GetProfileForBranch(branch string) (*Profile, string) {
	for name, profile := range c.Profiles {
		if profile.MatchBranch(branch) {
			p := profile
			p.Name = name
			return &p, name
		}
	}
	return nil, ""
}

// GetProfileOrAuto returns a profile by name, or auto-selects based on branch
func (c *Config) GetProfileOrAuto(name string, currentBranch string) (*Profile, string, error) {
	// If explicit profile requested, use it
	if name != "" {
		profile, ok := c.Profiles[name]
		if !ok {
			return nil, "", fmt.Errorf("profile %q not found", name)
		}
		profile.Name = name
		return &profile, name, nil
	}

	// Try to match current branch
	if currentBranch != "" {
		if profile, matchedName := c.GetProfileForBranch(currentBranch); profile != nil {
			return profile, matchedName, nil
		}
	}

	// Fall back to first profile
	for n, p := range c.Profiles {
		profile := p
		profile.Name = n
		return &profile, n, nil
	}

	return nil, "", fmt.Errorf("no profiles configured")
}

// MatchBranch checks if a git branch matches the profile's branch patterns
func (p *Profile) MatchBranch(branch string) bool {
	for _, pattern := range p.Branches {
		matched, _ := filepath.Match(pattern, branch)
		if matched {
			return true
		}
	}
	return false
}

// GetProjectRef returns the project ref to use (from profile or config)
func (p *Profile) GetProjectRef(config *Config) string {
	if p.Project != "" {
		return p.Project
	}
	return config.Project.ID
}

// ListProfileNames returns all profile names
func (c *Config) ListProfileNames() []string {
	names := make([]string, 0, len(c.Profiles))
	for name := range c.Profiles {
		names = append(names, name)
	}
	return names
}
