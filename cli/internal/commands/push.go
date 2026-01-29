package commands

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/supabase/supabase-dx/cli/internal/api"
	"github.com/supabase/supabase-dx/cli/internal/config"
	"github.com/supabase/supabase-dx/cli/internal/git"
	"github.com/supabase/supabase-dx/cli/internal/profiles"
)

type PushResult struct {
	Status           string   `json:"status"`
	Message          string   `json:"message"`
	Profile          string   `json:"profile,omitempty"`
	ProjectRef       string   `json:"project_ref,omitempty"`
	DryRun           bool     `json:"dry_run"`
	MigrationsFound  int      `json:"migrations_found,omitempty"`
	MigrationsApplied int     `json:"migrations_applied,omitempty"`
	FunctionsFound   int      `json:"functions_found,omitempty"`
	SecretsFound     int      `json:"secrets_found,omitempty"`
	Error            string   `json:"error,omitempty"`
}

type PushPlan struct {
	Migrations []string
	Functions  []string
	Secrets    []string
}

func NewPushCmd(profile *string, dryRun *bool, jsonOut *bool) *cobra.Command {
	var yes bool
	var migrationsOnly bool

	cmd := &cobra.Command{
		Use:   "push",
		Short: "Push local changes to remote (local → remote)",
		Long: `Push applies your local changes to the remote Supabase project.

Based on your profile configuration, this may:
- Apply pending database migrations
- Deploy edge functions
- Update remote configuration

By default, shows a plan and asks for confirmation.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPush(*profile, *dryRun, *jsonOut, yes, migrationsOnly)
		},
	}

	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "Skip confirmation prompt")
	cmd.Flags().BoolVar(&migrationsOnly, "migrations-only", false, "Only apply migrations")

	return cmd
}

func runPush(profileName string, dryRun bool, jsonOut bool, yes bool, migrationsOnly bool) error {
	// Get current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return pushError(jsonOut, "failed to get working directory", err)
	}

	// Load project config
	cfg, err := profiles.LoadConfig(cwd)
	if err != nil {
		return pushError(jsonOut, "failed to load config", err)
	}

	// Get current git branch for auto-selection
	currentBranch, _ := git.GetCurrentBranch(cwd)

	// Get profile
	profile, selectedName, err := cfg.GetProfileOrAuto(profileName, currentBranch)
	if err != nil {
		return pushError(jsonOut, "failed to get profile", err)
	}

	// Get project ref
	projectRef := profile.GetProjectRef(cfg)
	if projectRef == "" {
		return pushError(jsonOut, "no project ref configured", nil)
	}

	// Get access token
	token, err := config.GetAccessToken()
	if err != nil {
		return pushError(jsonOut, "authentication required", err)
	}

	// Create API client
	client := api.NewClient(token)

	// Build push plan
	plan, err := buildPushPlan(cwd, migrationsOnly)
	if err != nil {
		return pushError(jsonOut, "failed to build push plan", err)
	}

	// Initialize result
	result := PushResult{
		Status:          "success",
		Profile:         selectedName,
		ProjectRef:      projectRef,
		DryRun:          dryRun,
		MigrationsFound: len(plan.Migrations),
		FunctionsFound:  len(plan.Functions),
		SecretsFound:    len(plan.Secrets),
	}

	// Check if there's anything to push
	if len(plan.Migrations) == 0 && len(plan.Functions) == 0 {
		result.Message = "Nothing to push"
		if jsonOut {
			out, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(out))
			return nil
		}
		fmt.Println("✓ Nothing to push - everything is up to date")
		return nil
	}

	// Show plan
	if !jsonOut {
		fmt.Println("📤 Push Plan")
		fmt.Println()
		fmt.Printf("  Profile:    %s\n", selectedName)
		fmt.Printf("  Project:    %s\n", projectRef)
		fmt.Println()

		if len(plan.Migrations) > 0 {
			fmt.Printf("  Migrations (%d):\n", len(plan.Migrations))
			for _, m := range plan.Migrations {
				fmt.Printf("    + %s\n", m)
			}
			fmt.Println()
		}

		if len(plan.Functions) > 0 {
			fmt.Printf("  Functions (%d):\n", len(plan.Functions))
			for _, f := range plan.Functions {
				fmt.Printf("    + %s\n", f)
			}
			fmt.Println()
		}
	}

	// Dry run - don't apply
	if dryRun {
		result.Message = "Dry run - no changes applied"
		if jsonOut {
			out, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(out))
			return nil
		}
		fmt.Println("  (dry-run mode - no changes will be applied)")
		return nil
	}

	// Confirm unless --yes
	if !yes && !jsonOut {
		fmt.Print("Apply these changes? [y/N] ")
		reader := bufio.NewReader(os.Stdin)
		response, _ := reader.ReadString('\n')
		response = strings.TrimSpace(strings.ToLower(response))
		if response != "y" && response != "yes" {
			fmt.Println("Cancelled.")
			return nil
		}
	}

	// Apply migrations
	appliedMigrations := 0
	for _, migrationFile := range plan.Migrations {
		migrationPath := filepath.Join(cwd, "supabase", "migrations", migrationFile)
		content, err := os.ReadFile(migrationPath)
		if err != nil {
			if !jsonOut {
				fmt.Printf("  ✗ Failed to read %s: %v\n", migrationFile, err)
			}
			continue
		}

		// Extract version and name from filename (e.g., "20240101120000_create_users.sql")
		baseName := strings.TrimSuffix(migrationFile, ".sql")
		parts := strings.SplitN(baseName, "_", 2)
		name := ""
		if len(parts) > 1 {
			name = parts[1]
		}

		req := api.ApplyMigrationRequest{
			Query: string(content),
			Name:  name,
		}

		if err := client.ApplyMigration(projectRef, req); err != nil {
			if !jsonOut {
				fmt.Printf("  ✗ Failed to apply %s: %v\n", migrationFile, err)
			}
			result.Error = err.Error()
		} else {
			appliedMigrations++
			if !jsonOut {
				fmt.Printf("  ✓ Applied %s\n", migrationFile)
			}
		}
	}

	result.MigrationsApplied = appliedMigrations
	result.Message = fmt.Sprintf("Applied %d migrations", appliedMigrations)

	if jsonOut {
		out, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(out))
		return nil
	}

	fmt.Println()
	fmt.Printf("✓ Push completed - applied %d migrations\n", appliedMigrations)

	return nil
}

func buildPushPlan(cwd string, migrationsOnly bool) (*PushPlan, error) {
	plan := &PushPlan{
		Migrations: []string{},
		Functions:  []string{},
		Secrets:    []string{},
	}

	// Find migrations
	migrationsDir := filepath.Join(cwd, "supabase", "migrations")
	if entries, err := os.ReadDir(migrationsDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
				plan.Migrations = append(plan.Migrations, entry.Name())
			}
		}
	}

	if migrationsOnly {
		return plan, nil
	}

	// Find functions
	functionsDir := filepath.Join(cwd, "supabase", "functions")
	if entries, err := os.ReadDir(functionsDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") && entry.Name() != "_shared" {
				// Check if function has an index.ts
				indexPath := filepath.Join(functionsDir, entry.Name(), "index.ts")
				if _, err := os.Stat(indexPath); err == nil {
					plan.Functions = append(plan.Functions, entry.Name())
				}
			}
		}
	}

	return plan, nil
}

func pushError(jsonOut bool, message string, err error) error {
	if jsonOut {
		result := PushResult{
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
