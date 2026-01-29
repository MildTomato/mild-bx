package commands

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/supabase/supabase-dx/cli/internal/api"
	"github.com/supabase/supabase-dx/cli/internal/config"
)

type LoginResult struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

func NewLoginCmd(jsonOut *bool) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate with Supabase",
		Long: `Authenticate with Supabase using a Personal Access Token (PAT).

You can generate a PAT at: https://supabase.com/dashboard/account/tokens

The token will be stored in ~/.supabase-dx/config.json.
Alternatively, set the SUPABASE_ACCESS_TOKEN environment variable.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if *jsonOut {
				return loginJSON()
			}
			return loginInteractive()
		},
	}

	return cmd
}

func loginInteractive() error {
	fmt.Println("Enter your Supabase Personal Access Token (PAT):")
	fmt.Println("You can generate one at: https://supabase.com/dashboard/account/tokens")
	fmt.Print("\nToken: ")

	reader := bufio.NewReader(os.Stdin)
	token, err := reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("failed to read token: %w", err)
	}
	token = strings.TrimSpace(token)

	if token == "" {
		return fmt.Errorf("token cannot be empty")
	}

	// Verify the token works
	fmt.Println("\nVerifying token...")
	client := api.NewClient(token)
	projects, err := client.ListProjects()
	if err != nil {
		return fmt.Errorf("token verification failed: %w", err)
	}

	// Save the token
	cfg := &config.GlobalConfig{
		AccessToken: token,
	}
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("failed to save token: %w", err)
	}

	fmt.Printf("\n✓ Logged in successfully! Found %d projects.\n", len(projects))
	return nil
}

func loginJSON() error {
	result := LoginResult{
		Status:  "requires_input",
		Message: "Login requires interactive input. Please run without --json flag.",
	}
	out, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(out))
	return nil
}
