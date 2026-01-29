package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewClient(t *testing.T) {
	token := "test-token"
	client := NewClient(token)

	if client.Token != token {
		t.Errorf("expected token %s, got %s", token, client.Token)
	}

	if client.BaseURL != DefaultBaseURL {
		t.Errorf("expected base URL %s, got %s", DefaultBaseURL, client.BaseURL)
	}

	if client.HTTPClient == nil {
		t.Error("expected HTTPClient to be initialized")
	}
}

func TestListProjects(t *testing.T) {
	// Create mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify auth header
		auth := r.Header.Get("Authorization")
		if auth != "Bearer test-token" {
			t.Errorf("expected Authorization header 'Bearer test-token', got '%s'", auth)
		}

		// Verify path
		if r.URL.Path != "/v1/projects" {
			t.Errorf("expected path /v1/projects, got %s", r.URL.Path)
		}

		// Return mock response
		projects := []Project{
			{
				ID:     "project-1",
				Ref:    "abcdefghijklmnopqrst",
				Name:   "Test Project",
				Region: "us-east-1",
				Status: "ACTIVE_HEALTHY",
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(projects)
	}))
	defer server.Close()

	// Create client with mock server
	client := NewClient("test-token")
	client.BaseURL = server.URL

	// Test
	projects, err := client.ListProjects()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(projects))
	}

	if projects[0].Name != "Test Project" {
		t.Errorf("expected project name 'Test Project', got '%s'", projects[0].Name)
	}
}

func TestGetProject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/projects/abcdefghijklmnopqrst" {
			t.Errorf("expected path /v1/projects/abcdefghijklmnopqrst, got %s", r.URL.Path)
		}

		project := Project{
			ID:     "project-1",
			Ref:    "abcdefghijklmnopqrst",
			Name:   "Test Project",
			Region: "us-east-1",
			Status: "ACTIVE_HEALTHY",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(project)
	}))
	defer server.Close()

	client := NewClient("test-token")
	client.BaseURL = server.URL

	project, err := client.GetProject("abcdefghijklmnopqrst")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if project.Name != "Test Project" {
		t.Errorf("expected project name 'Test Project', got '%s'", project.Name)
	}
}

func TestListBranches(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/projects/abcdefghijklmnopqrst/branches" {
			t.Errorf("expected path /v1/projects/abcdefghijklmnopqrst/branches, got %s", r.URL.Path)
		}

		branches := []Branch{
			{
				ID:        "branch-1",
				Name:      "main",
				IsDefault: true,
				Status:    "MIGRATIONS_PASSED",
			},
			{
				ID:        "branch-2",
				Name:      "feature-x",
				IsDefault: false,
				GitBranch: "feature/x",
				Status:    "MIGRATIONS_PASSED",
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(branches)
	}))
	defer server.Close()

	client := NewClient("test-token")
	client.BaseURL = server.URL

	branches, err := client.ListBranches("abcdefghijklmnopqrst")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(branches) != 2 {
		t.Fatalf("expected 2 branches, got %d", len(branches))
	}

	if !branches[0].IsDefault {
		t.Error("expected first branch to be default")
	}
}

func TestListFunctions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/projects/abcdefghijklmnopqrst/functions" {
			t.Errorf("expected path /v1/projects/abcdefghijklmnopqrst/functions, got %s", r.URL.Path)
		}

		functions := []Function{
			{
				ID:      "func-1",
				Slug:    "hello-world",
				Name:    "hello-world",
				Status:  "ACTIVE",
				Version: 1,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(functions)
	}))
	defer server.Close()

	client := NewClient("test-token")
	client.BaseURL = server.URL

	functions, err := client.ListFunctions("abcdefghijklmnopqrst")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(functions) != 1 {
		t.Fatalf("expected 1 function, got %d", len(functions))
	}

	if functions[0].Slug != "hello-world" {
		t.Errorf("expected function slug 'hello-world', got '%s'", functions[0].Slug)
	}
}

func TestGetTypescriptTypes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/projects/abcdefghijklmnopqrst/types/typescript" {
			t.Errorf("expected path /v1/projects/abcdefghijklmnopqrst/types/typescript, got %s", r.URL.Path)
		}

		resp := TypescriptResponse{
			Types: "export type Database = { public: { Tables: {} } }",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient("test-token")
	client.BaseURL = server.URL

	types, err := client.GetTypescriptTypes("abcdefghijklmnopqrst", "public")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if types.Types == "" {
		t.Error("expected non-empty types")
	}
}

func TestAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"message": "Invalid token"}`))
	}))
	defer server.Close()

	client := NewClient("bad-token")
	client.BaseURL = server.URL

	_, err := client.ListProjects()
	if err == nil {
		t.Error("expected error for 401 response")
	}
}
