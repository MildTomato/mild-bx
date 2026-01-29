package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestIsGitRepo(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "git-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Before init - should not be a repo
	if IsGitRepo(tmpDir) {
		t.Error("expected non-git directory to return false")
	}

	// Create .git directory
	gitDir := filepath.Join(tmpDir, ".git")
	if err := os.Mkdir(gitDir, 0755); err != nil {
		t.Fatalf("failed to create .git dir: %v", err)
	}

	// After creating .git - should be a repo
	if !IsGitRepo(tmpDir) {
		t.Error("expected directory with .git to return true")
	}
}

func TestGetCurrentBranch(t *testing.T) {
	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "git-branch-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create .git directory with HEAD file
	gitDir := filepath.Join(tmpDir, ".git")
	if err := os.Mkdir(gitDir, 0755); err != nil {
		t.Fatalf("failed to create .git dir: %v", err)
	}

	// Write HEAD file
	headPath := filepath.Join(gitDir, "HEAD")
	if err := os.WriteFile(headPath, []byte("ref: refs/heads/feature/test-branch\n"), 0644); err != nil {
		t.Fatalf("failed to write HEAD: %v", err)
	}

	// Test
	branch, err := GetCurrentBranch(tmpDir)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if branch != "feature/test-branch" {
		t.Errorf("expected branch 'feature/test-branch', got '%s'", branch)
	}
}

func TestGetCurrentBranchWithGit(t *testing.T) {
	// Skip if git is not available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	// Create temp directory and init git repo
	tmpDir, err := os.MkdirTemp("", "git-real-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("failed to init git: %v", err)
	}

	// Configure git user for commits
	cmd = exec.Command("git", "config", "user.email", "test@test.com")
	cmd.Dir = tmpDir
	cmd.Run()

	cmd = exec.Command("git", "config", "user.name", "Test")
	cmd.Dir = tmpDir
	cmd.Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	os.WriteFile(testFile, []byte("test"), 0644)

	cmd = exec.Command("git", "add", ".")
	cmd.Dir = tmpDir
	cmd.Run()

	cmd = exec.Command("git", "commit", "-m", "initial")
	cmd.Dir = tmpDir
	cmd.Run()

	// Create and checkout new branch
	cmd = exec.Command("git", "checkout", "-b", "test-branch")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("failed to create branch: %v", err)
	}

	// Test
	branch, err := GetCurrentBranch(tmpDir)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if branch != "test-branch" {
		t.Errorf("expected branch 'test-branch', got '%s'", branch)
	}
}
