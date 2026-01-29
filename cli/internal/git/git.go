package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// GetCurrentBranch returns the current git branch name
func GetCurrentBranch(dir string) (string, error) {
	// First try reading .git/HEAD directly (faster, no exec)
	headPath := filepath.Join(dir, ".git", "HEAD")
	data, err := os.ReadFile(headPath)
	if err == nil {
		content := strings.TrimSpace(string(data))
		// Format: "ref: refs/heads/branch-name"
		if strings.HasPrefix(content, "ref: refs/heads/") {
			return strings.TrimPrefix(content, "ref: refs/heads/"), nil
		}
		// Detached HEAD - return the SHA
		return content[:7], nil
	}

	// Fall back to git command
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(output)), nil
}

// IsGitRepo checks if the directory is inside a git repository
func IsGitRepo(dir string) bool {
	gitDir := filepath.Join(dir, ".git")
	info, err := os.Stat(gitDir)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// GetRepoRoot returns the root directory of the git repository
func GetRepoRoot(dir string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// GetRemoteURL returns the origin remote URL
func GetRemoteURL(dir string) (string, error) {
	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// HasUncommittedChanges checks if there are uncommitted changes
func HasUncommittedChanges(dir string) (bool, error) {
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return false, err
	}
	return len(strings.TrimSpace(string(output))) > 0, nil
}

// GetHeadCommit returns the current HEAD commit SHA
func GetHeadCommit(dir string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}
