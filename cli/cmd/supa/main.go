package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/supabase/supabase-dx/cli/internal/commands"
)

var (
	version = "0.0.1"
	profile string
	dryRun  bool
	jsonOut bool
)

func main() {
	rootCmd := &cobra.Command{
		Use:     "supa",
		Short:   "Supabase DX CLI - experimental developer experience tools",
		Version: version,
	}

	// Global flags
	rootCmd.PersistentFlags().StringVarP(&profile, "profile", "p", "", "Profile to use (from ./supabase/config.toml)")
	rootCmd.PersistentFlags().BoolVar(&dryRun, "dry-run", false, "Show what would happen without making changes")
	rootCmd.PersistentFlags().BoolVar(&jsonOut, "json", false, "Output as JSON (for scripts/extension)")

	// Add commands
	rootCmd.AddCommand(commands.NewLoginCmd(&jsonOut))
	rootCmd.AddCommand(commands.NewProjectsCmd(&jsonOut))
	rootCmd.AddCommand(commands.NewPullCmd(&profile, &dryRun, &jsonOut))
	rootCmd.AddCommand(commands.NewPushCmd(&profile, &dryRun, &jsonOut))
	rootCmd.AddCommand(commands.NewWatchCmd(&profile, &jsonOut))

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
