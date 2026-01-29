package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	// DefaultBaseURL is the Supabase Management API base URL
	DefaultBaseURL = "https://api.supabase.com"
)

// Client is a Supabase Management API client
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	Token      string
}

// NewClient creates a new Management API client
func NewClient(token string) *Client {
	return &Client{
		BaseURL: DefaultBaseURL,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		Token: token,
	}
}

// =============================================================================
// Projects
// =============================================================================

// Project represents a Supabase project
type Project struct {
	ID               string    `json:"id"`
	Ref              string    `json:"ref"`
	Name             string    `json:"name"`
	OrganizationID   string    `json:"organization_id"`
	OrganizationSlug string    `json:"organization_slug"`
	Region           string    `json:"region"`
	Status           string    `json:"status"`
	CreatedAt        string    `json:"created_at"`
	Database         *Database `json:"database,omitempty"`
}

// Database represents database info within a project
type Database struct {
	Host           string `json:"host"`
	Version        string `json:"version"`
	PostgresEngine string `json:"postgres_engine"`
}

// ListProjects returns all projects accessible to the authenticated user
func (c *Client) ListProjects() ([]Project, error) {
	resp, err := c.doRequest("GET", "/v1/projects", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var projects []Project
	if err := json.NewDecoder(resp.Body).Decode(&projects); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return projects, nil
}

// GetProject returns a specific project by ref
func (c *Client) GetProject(projectRef string) (*Project, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/v1/projects/%s", projectRef), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var project Project
	if err := json.NewDecoder(resp.Body).Decode(&project); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &project, nil
}

// =============================================================================
// Branches
// =============================================================================

// Branch represents a Supabase database branch
type Branch struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	ProjectRef       string `json:"project_ref"`
	ParentProjectRef string `json:"parent_project_ref"`
	IsDefault        bool   `json:"is_default"`
	Persistent       bool   `json:"persistent"`
	Status           string `json:"status"`
	GitBranch        string `json:"git_branch,omitempty"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

// ListBranches returns all branches for a project
func (c *Client) ListBranches(projectRef string) ([]Branch, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/v1/projects/%s/branches", projectRef), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var branches []Branch
	if err := json.NewDecoder(resp.Body).Decode(&branches); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return branches, nil
}

// GetBranch returns a specific branch by name
func (c *Client) GetBranch(projectRef, branchName string) (*Branch, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/v1/projects/%s/branches/%s", projectRef, branchName), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var branch Branch
	if err := json.NewDecoder(resp.Body).Decode(&branch); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &branch, nil
}

// CreateBranchRequest is the request body for creating a branch
type CreateBranchRequest struct {
	BranchName string `json:"branch_name"`
	GitBranch  string `json:"git_branch,omitempty"`
	Region     string `json:"region,omitempty"`
}

// CreateBranch creates a new database branch
func (c *Client) CreateBranch(projectRef string, req CreateBranchRequest) (*Branch, error) {
	resp, err := c.doRequest("POST", fmt.Sprintf("/v1/projects/%s/branches", projectRef), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var branch Branch
	if err := json.NewDecoder(resp.Body).Decode(&branch); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &branch, nil
}

// DeleteBranch deletes a database branch
func (c *Client) DeleteBranch(branchRef string) error {
	resp, err := c.doRequest("DELETE", fmt.Sprintf("/v1/branches/%s", branchRef), nil)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// =============================================================================
// TypeScript Types
// =============================================================================

// TypescriptResponse contains generated TypeScript types
type TypescriptResponse struct {
	Types string `json:"types"`
}

// GetTypescriptTypes generates TypeScript types for the project schema
func (c *Client) GetTypescriptTypes(projectRef string, schemas string) (*TypescriptResponse, error) {
	path := fmt.Sprintf("/v1/projects/%s/types/typescript", projectRef)
	if schemas != "" {
		path += "?included_schemas=" + schemas
	}

	resp, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result TypescriptResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// =============================================================================
// Edge Functions
// =============================================================================

// Function represents a Supabase Edge Function
type Function struct {
	ID            string `json:"id"`
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	Status        string `json:"status"`
	Version       int    `json:"version"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
	VerifyJWT     bool   `json:"verify_jwt"`
	ImportMap     bool   `json:"import_map"`
	EntrypointPath string `json:"entrypoint_path,omitempty"`
}

// ListFunctions returns all edge functions for a project
func (c *Client) ListFunctions(projectRef string) ([]Function, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/v1/projects/%s/functions", projectRef), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var functions []Function
	if err := json.NewDecoder(resp.Body).Decode(&functions); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return functions, nil
}

// GetFunction returns a specific edge function
func (c *Client) GetFunction(projectRef, functionSlug string) (*Function, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/v1/projects/%s/functions/%s", projectRef, functionSlug), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var fn Function
	if err := json.NewDecoder(resp.Body).Decode(&fn); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &fn, nil
}

// DeleteFunction deletes an edge function
func (c *Client) DeleteFunction(projectRef, functionSlug string) error {
	resp, err := c.doRequest("DELETE", fmt.Sprintf("/v1/projects/%s/functions/%s", projectRef, functionSlug), nil)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// =============================================================================
// Secrets
// =============================================================================

// Secret represents a project secret
type Secret struct {
	Name      string `json:"name"`
	Value     string `json:"value,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

// ListSecrets returns all secrets for a project
func (c *Client) ListSecrets(projectRef string) ([]Secret, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/v1/projects/%s/secrets", projectRef), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var secrets []Secret
	if err := json.NewDecoder(resp.Body).Decode(&secrets); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return secrets, nil
}

// CreateSecrets creates multiple secrets
func (c *Client) CreateSecrets(projectRef string, secrets []Secret) error {
	resp, err := c.doRequest("POST", fmt.Sprintf("/v1/projects/%s/secrets", projectRef), secrets)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// DeleteSecrets deletes secrets by name
func (c *Client) DeleteSecrets(projectRef string, names []string) error {
	resp, err := c.doRequest("DELETE", fmt.Sprintf("/v1/projects/%s/secrets", projectRef), names)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// =============================================================================
// Migrations
// =============================================================================

// Migration represents a database migration
type Migration struct {
	Version string `json:"version"`
	Name    string `json:"name,omitempty"`
}

// ListMigrations returns applied migrations for a project
func (c *Client) ListMigrations(projectRef string) ([]Migration, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/v1/projects/%s/database/migrations", projectRef), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var migrations []Migration
	if err := json.NewDecoder(resp.Body).Decode(&migrations); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return migrations, nil
}

// ApplyMigrationRequest is the request body for applying a migration
type ApplyMigrationRequest struct {
	Query    string `json:"query"`
	Name     string `json:"name,omitempty"`
	Rollback string `json:"rollback,omitempty"`
}

// ApplyMigration applies a database migration
func (c *Client) ApplyMigration(projectRef string, req ApplyMigrationRequest) error {
	resp, err := c.doRequest("POST", fmt.Sprintf("/v1/projects/%s/database/migrations", projectRef), req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// =============================================================================
// Database Queries
// =============================================================================

// RunQueryRequest is the request body for running a query
type RunQueryRequest struct {
	Query string `json:"query"`
}

// RunQuery runs a SQL query against the project database
func (c *Client) RunQuery(projectRef string, query string) (json.RawMessage, error) {
	req := RunQueryRequest{Query: query}
	resp, err := c.doRequest("POST", fmt.Sprintf("/v1/projects/%s/database/query", projectRef), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result, nil
}

// =============================================================================
// Branch Diff
// =============================================================================

// GetBranchDiff returns the schema diff for a branch
func (c *Client) GetBranchDiff(branchRef string, includedSchemas string) (string, error) {
	path := fmt.Sprintf("/v1/branches/%s/diff", branchRef)
	if includedSchemas != "" {
		path += "?included_schemas=" + includedSchemas
	}

	resp, err := c.doRequest("GET", path, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	return string(body), nil
}

// =============================================================================
// Organizations
// =============================================================================

// Organization represents a Supabase organization
type Organization struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// ListOrganizations returns all organizations the user belongs to
func (c *Client) ListOrganizations() ([]Organization, error) {
	resp, err := c.doRequest("GET", "/v1/organizations", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var orgs []Organization
	if err := json.NewDecoder(resp.Body).Decode(&orgs); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return orgs, nil
}

// =============================================================================
// Health
// =============================================================================

// ServiceHealth represents a service health status
type ServiceHealth struct {
	Name    string `json:"name"`
	Healthy bool   `json:"healthy"`
	Status  string `json:"status"`
}

// GetHealth returns health status of project services
func (c *Client) GetHealth(projectRef string, services []string) ([]ServiceHealth, error) {
	path := fmt.Sprintf("/v1/projects/%s/health?services=%s", projectRef, joinStrings(services, ","))

	resp, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var health []ServiceHealth
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return health, nil
}

// =============================================================================
// HTTP Client
// =============================================================================

// doRequest performs an authenticated HTTP request
func (c *Client) doRequest(method, path string, body interface{}) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequest(method, c.BaseURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	return resp, nil
}

// joinStrings joins strings with a separator
func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}
