package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/supabase/supabase-dx/cli/internal/api"
	"github.com/supabase/supabase-dx/cli/internal/config"
	"github.com/supabase/supabase-dx/cli/internal/git"
	"github.com/supabase/supabase-dx/cli/internal/profiles"
)

type WatchResult struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Profile string `json:"profile,omitempty"`
	Error   string `json:"error,omitempty"`
}

type WatchState struct {
	Profile       string
	ProjectRef    string
	LastBranch    string
	LastTypesGen  time.Time
	TypesInterval time.Duration
}

func NewWatchCmd(profile *string, jsonOut *bool) *cobra.Command {
	var typesInterval string
	var noBranchWatch bool

	cmd := &cobra.Command{
		Use:   "watch",
		Short: "Watch for changes and keep things running",
		Long: `Watch monitors your project for changes and takes action automatically.

This includes:
- Detecting git branch changes and switching profiles
- Regenerating TypeScript types when schema changes
- Watching for file changes in supabase/ directory`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runWatch(*profile, *jsonOut, typesInterval, noBranchWatch)
		},
	}

	cmd.Flags().StringVar(&typesInterval, "types-interval", "30s", "Interval for regenerating types (e.g., 30s, 1m, 5m)")
	cmd.Flags().BoolVar(&noBranchWatch, "no-branch-watch", false, "Disable git branch watching")

	return cmd
}

func runWatch(profileName string, jsonOut bool, typesInterval string, noBranchWatch bool) error {
	// Get current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return watchError(jsonOut, "failed to get working directory", err)
	}

	// Load project config
	cfg, err := profiles.LoadConfig(cwd)
	if err != nil {
		return watchError(jsonOut, "failed to load config", err)
	}

	// Get current git branch
	currentBranch, _ := git.GetCurrentBranch(cwd)

	// Get profile
	profile, selectedName, err := cfg.GetProfileOrAuto(profileName, currentBranch)
	if err != nil {
		return watchError(jsonOut, "failed to get profile", err)
	}

	// Get project ref
	projectRef := profile.GetProjectRef(cfg)
	if projectRef == "" {
		return watchError(jsonOut, "no project ref configured", nil)
	}

	// Get access token
	token, err := config.GetAccessToken()
	if err != nil {
		return watchError(jsonOut, "authentication required", err)
	}

	// Parse types interval
	interval, err := time.ParseDuration(typesInterval)
	if err != nil {
		interval = 30 * time.Second
	}

	// JSON mode - just output status and exit
	if jsonOut {
		result := WatchResult{
			Status:  "running",
			Message: "Watch mode started",
			Profile: selectedName,
		}
		out, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(out))
		// Continue to watch loop but output events as JSON
	} else {
		fmt.Println("👀 Watch mode started")
		fmt.Println()
		fmt.Printf("  Profile:       %s\n", selectedName)
		fmt.Printf("  Project:       %s\n", projectRef)
		fmt.Printf("  Git branch:    %s\n", currentBranch)
		fmt.Printf("  Types refresh: every %s\n", interval)
		fmt.Println()
		fmt.Println("Press Ctrl+C to stop")
		fmt.Println()
	}

	// Create API client
	client := api.NewClient(token)

	// Initialize state
	state := &WatchState{
		Profile:       selectedName,
		ProjectRef:    projectRef,
		LastBranch:    currentBranch,
		TypesInterval: interval,
	}

	// Set up signal handling
	ctx, cancel := context.WithCancel(context.Background())
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		cancel()
	}()

	// Main watch loop
	ticker := time.NewTicker(5 * time.Second)
	typesTicker := time.NewTicker(interval)
	defer ticker.Stop()
	defer typesTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			if jsonOut {
				result := WatchResult{
					Status:  "stopped",
					Message: "Watch mode stopped",
					Profile: state.Profile,
				}
				out, _ := json.MarshalIndent(result, "", "  ")
				fmt.Println(string(out))
			} else {
				fmt.Println("\n👋 Watch mode stopped")
			}
			return nil

		case <-ticker.C:
			// Check for git branch changes
			if !noBranchWatch {
				checkBranchChange(cwd, cfg, state, jsonOut)
			}

		case <-typesTicker.C:
			// Regenerate types
			regenerateTypes(client, state.ProjectRef, cwd, jsonOut)
		}
	}
}

func checkBranchChange(cwd string, cfg *profiles.Config, state *WatchState, jsonOut bool) {
	currentBranch, err := git.GetCurrentBranch(cwd)
	if err != nil {
		return
	}

	if currentBranch != state.LastBranch {
		state.LastBranch = currentBranch

		// Try to find a matching profile
		if profile, name := cfg.GetProfileForBranch(currentBranch); profile != nil {
			if name != state.Profile {
				state.Profile = name
				state.ProjectRef = profile.GetProjectRef(cfg)

				if jsonOut {
					event := map[string]string{
						"event":      "profile_changed",
						"branch":     currentBranch,
						"profile":    name,
						"project_ref": state.ProjectRef,
					}
					out, _ := json.Marshal(event)
					fmt.Println(string(out))
				} else {
					fmt.Printf("🔄 Branch changed to %s → switched to profile %s\n", currentBranch, name)
				}
			}
		} else {
			if jsonOut {
				event := map[string]string{
					"event":   "branch_changed",
					"branch":  currentBranch,
					"profile": state.Profile,
				}
				out, _ := json.Marshal(event)
				fmt.Println(string(out))
			} else {
				fmt.Printf("🌿 Branch changed to %s (keeping profile %s)\n", currentBranch, state.Profile)
			}
		}
	}
}

func regenerateTypes(client *api.Client, projectRef, cwd string, jsonOut bool) {
	typesResp, err := client.GetTypescriptTypes(projectRef, "public")
	if err != nil {
		if jsonOut {
			event := map[string]string{
				"event": "types_error",
				"error": err.Error(),
			}
			out, _ := json.Marshal(event)
			fmt.Println(string(out))
		}
		return
	}

	typesPath := filepath.Join(cwd, "supabase", "types", "database.ts")
	
	// Check if types changed
	existingTypes, _ := os.ReadFile(typesPath)
	if string(existingTypes) == typesResp.Types {
		return // No change
	}

	// Write new types
	if err := os.MkdirAll(filepath.Dir(typesPath), 0755); err != nil {
		return
	}
	if err := os.WriteFile(typesPath, []byte(typesResp.Types), 0644); err != nil {
		return
	}

	if jsonOut {
		event := map[string]string{
			"event": "types_updated",
			"path":  typesPath,
		}
		out, _ := json.Marshal(event)
		fmt.Println(string(out))
	} else {
		// Get relative path for cleaner output
		relPath := strings.TrimPrefix(typesPath, cwd+"/")
		fmt.Printf("📝 Types updated: %s\n", relPath)
	}
}

func watchError(jsonOut bool, message string, err error) error {
	if jsonOut {
		result := WatchResult{
			Status:  "error",
			Message: message,
		}
		if err != nil {
			result.Error = err.Error()
		}
		out, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(out))
		return nil
	}

	if err != nil {
		return fmt.Errorf("%s: %w", message, err)
	}
	return fmt.Errorf("%s", message)
}
