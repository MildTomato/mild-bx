package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/supabase/supabase-dx/cli/internal/api"
	"github.com/supabase/supabase-dx/cli/internal/config"
	"github.com/supabase/supabase-dx/cli/internal/git"
	"github.com/supabase/supabase-dx/cli/internal/profiles"
)

type PullResult struct {
	Status      string        `json:"status"`
	Message     string        `json:"message"`
	Profile     string        `json:"profile,omitempty"`
	ProjectRef  string        `json:"project_ref,omitempty"`
	DryRun      bool          `json:"dry_run"`
	Project     *api.Project  `json:"project,omitempty"`
	Branches    []api.Branch  `json:"branches,omitempty"`
	Functions   []api.Function `json:"functions,omitempty"`
	TypesWritten bool         `json:"types_written,omitempty"`
	Error       string        `json:"error,omitempty"`
}

func NewPullCmd(profile *string, dryRun *bool, jsonOut *bool) *cobra.Command {
	var typesOnly bool
	var schemas string

	cmd := &cobra.Command{
		Use:   "pull",
		Short: "Pull remote state to local (remote → local)",
		Long: `Pull synchronizes your local environment with the remote Supabase project.

Based on your profile configuration, this may:
- Fetch database schema and create migration files
- Download edge functions
- Update local configuration
- Generate TypeScript types
- Apply changes to your local Supabase instance`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPull(*profile, *dryRun, *jsonOut, typesOnly, schemas)
		},
	}

	cmd.Flags().BoolVar(&typesOnly, "types-only", false, "Only generate TypeScript types")
	cmd.Flags().StringVar(&schemas, "schemas", "public", "Schemas to include for type generation")

	return cmd
}

func runPull(profileName string, dryRun bool, jsonOut bool, typesOnly bool, schemas string) error {
	// Get current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return outputError(jsonOut, "failed to get working directory", err)
	}

	// Load project config
	cfg, err := profiles.LoadConfig(cwd)
	if err != nil {
		return outputError(jsonOut, "failed to load config", err)
	}

	// Get current git branch for auto-selection
	currentBranch, _ := git.GetCurrentBranch(cwd)

	// Get profile
	profile, selectedName, err := cfg.GetProfileOrAuto(profileName, currentBranch)
	if err != nil {
		return outputError(jsonOut, "failed to get profile", err)
	}

	// Get project ref
	projectRef := profile.GetProjectRef(cfg)
	if projectRef == "" {
		return outputError(jsonOut, "no project ref configured", nil)
	}

	// Get access token
	token, err := config.GetAccessToken()
	if err != nil {
		return outputError(jsonOut, "authentication required", err)
	}

	// Create API client
	client := api.NewClient(token)

	// Initialize result
	result := PullResult{
		Status:     "success",
		Profile:    selectedName,
		ProjectRef: projectRef,
		DryRun:     dryRun,
	}

	// If types-only mode, just generate types
	if typesOnly {
		return pullTypes(client, projectRef, schemas, cwd, dryRun, jsonOut, result)
	}

	// Fetch project info
	project, err := client.GetProject(projectRef)
	if err != nil {
		return outputError(jsonOut, "failed to fetch project", err)
	}
	result.Project = project

	// Fetch branches
	branches, err := client.ListBranches(projectRef)
	if err != nil {
		// Branches might not be enabled, not a fatal error
		if !jsonOut {
			fmt.Printf("  ⚠ Could not fetch branches: %v\n", err)
		}
	} else {
		result.Branches = branches
	}

	// Fetch functions
	functions, err := client.ListFunctions(projectRef)
	if err != nil {
		if !jsonOut {
			fmt.Printf("  ⚠ Could not fetch functions: %v\n", err)
		}
	} else {
		result.Functions = functions
	}

	// Generate types
	if !dryRun {
		typesResp, err := client.GetTypescriptTypes(projectRef, schemas)
		if err != nil {
			if !jsonOut {
				fmt.Printf("  ⚠ Could not generate types: %v\n", err)
			}
		} else {
			// Write types to file
			typesPath := filepath.Join(cwd, "supabase", "types", "database.ts")
			if err := os.MkdirAll(filepath.Dir(typesPath), 0755); err == nil {
				if err := os.WriteFile(typesPath, []byte(typesResp.Types), 0644); err == nil {
					result.TypesWritten = true
				}
			}
		}
	}

	// Output result
	if jsonOut {
		out, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(out))
		return nil
	}

	// Pretty print
	fmt.Println("📥 Pull completed")
	fmt.Println()
	fmt.Printf("  Profile:    %s\n", selectedName)
	fmt.Printf("  Project:    %s (%s)\n", project.Name, projectRef)
	fmt.Printf("  Region:     %s\n", project.Region)
	fmt.Printf("  Status:     %s\n", project.Status)
	fmt.Println()

	if len(result.Branches) > 0 {
		fmt.Printf("  Branches:   %d\n", len(result.Branches))
		for _, b := range result.Branches {
			marker := " "
			if b.IsDefault {
				marker = "*"
			}
			fmt.Printf("    %s %s\n", marker, b.Name)
		}
		fmt.Println()
	}

	if len(result.Functions) > 0 {
		fmt.Printf("  Functions:  %d\n", len(result.Functions))
		for _, f := range result.Functions {
			fmt.Printf("    - %s (v%d)\n", f.Slug, f.Version)
		}
		fmt.Println()
	}

	if result.TypesWritten {
		fmt.Println("  ✓ TypeScript types written to supabase/types/database.ts")
	}

	if dryRun {
		fmt.Println("\n  (dry-run mode - no changes applied)")
	}

	return nil
}

func pullTypes(client *api.Client, projectRef, schemas, cwd string, dryRun, jsonOut bool, result PullResult) error {
	typesResp, err := client.GetTypescriptTypes(projectRef, schemas)
	if err != nil {
		return outputError(jsonOut, "failed to generate types", err)
	}

	if !dryRun {
		typesPath := filepath.Join(cwd, "supabase", "types", "database.ts")
		if err := os.MkdirAll(filepath.Dir(typesPath), 0755); err != nil {
			return outputError(jsonOut, "failed to create types directory", err)
		}
		if err := os.WriteFile(typesPath, []byte(typesResp.Types), 0644); err != nil {
			return outputError(jsonOut, "failed to write types file", err)
		}
		result.TypesWritten = true
	}

	if jsonOut {
		result.Message = "TypeScript types generated"
		out, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(out))
		return nil
	}

	fmt.Println("📥 TypeScript types generated")
	if !dryRun {
		fmt.Println("  ✓ Written to supabase/types/database.ts")
	} else {
		fmt.Println("  (dry-run mode - not written)")
	}

	return nil
}

func outputError(jsonOut bool, message string, err error) error {
	if jsonOut {
		result := PullResult{
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
