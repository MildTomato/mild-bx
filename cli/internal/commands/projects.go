package commands

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/supabase/supabase-dx/cli/internal/api"
	"github.com/supabase/supabase-dx/cli/internal/config"
)

type ProjectsResult struct {
	Status   string        `json:"status"`
	Projects []api.Project `json:"projects,omitempty"`
	Error    string        `json:"error,omitempty"`
}

func NewProjectsCmd(jsonOut *bool) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "projects",
		Short: "List your Supabase projects",
		Long:  `Lists all Supabase projects you have access to.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			token, err := config.GetAccessToken()
			if err != nil {
				if *jsonOut {
					result := ProjectsResult{
						Status: "error",
						Error:  err.Error(),
					}
					out, _ := json.MarshalIndent(result, "", "  ")
					fmt.Println(string(out))
					return nil
				}
				return err
			}

			client := api.NewClient(token)
			projects, err := client.ListProjects()
			if err != nil {
				if *jsonOut {
					result := ProjectsResult{
						Status: "error",
						Error:  err.Error(),
					}
					out, _ := json.MarshalIndent(result, "", "  ")
					fmt.Println(string(out))
					return nil
				}
				return fmt.Errorf("failed to list projects: %w", err)
			}

			if *jsonOut {
				result := ProjectsResult{
					Status:   "success",
					Projects: projects,
				}
				out, _ := json.MarshalIndent(result, "", "  ")
				fmt.Println(string(out))
				return nil
			}

			// Pretty print
			if len(projects) == 0 {
				fmt.Println("No projects found.")
				return nil
			}

			fmt.Printf("Found %d project(s):\n\n", len(projects))
			for _, p := range projects {
				fmt.Printf("  %s\n", p.Name)
				fmt.Printf("    ID:     %s\n", p.ID)
				fmt.Printf("    Region: %s\n", p.Region)
				fmt.Printf("    Status: %s\n", p.Status)
				fmt.Println()
			}

			return nil
		},
	}

	return cmd
}
