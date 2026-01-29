package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/table"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Styles
var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("205")).
			MarginBottom(1)

	successStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("42"))

	errorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("196"))

	warningStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("214"))

	infoStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("75"))

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("240"))

	selectedStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("205")).
			Bold(true)

	tableStyle = lipgloss.NewStyle().
			BorderStyle(lipgloss.NormalBorder()).
			BorderForeground(lipgloss.Color("240"))
)

// =============================================================================
// Spinner Model
// =============================================================================

type SpinnerModel struct {
	spinner  spinner.Model
	message  string
	quitting bool
	done     bool
	err      error
}

func NewSpinner(message string) SpinnerModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))
	return SpinnerModel{
		spinner: s,
		message: message,
	}
}

func (m SpinnerModel) Init() tea.Cmd {
	return m.spinner.Tick
}

func (m SpinnerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		}

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd

	case DoneMsg:
		m.done = true
		return m, tea.Quit

	case ErrorMsg:
		m.err = msg.Err
		return m, tea.Quit
	}

	return m, nil
}

func (m SpinnerModel) View() string {
	if m.done {
		return successStyle.Render("✓ " + m.message + " - done!\n")
	}
	if m.err != nil {
		return errorStyle.Render("✗ " + m.message + " - " + m.err.Error() + "\n")
	}
	if m.quitting {
		return dimStyle.Render("Cancelled\n")
	}
	return m.spinner.View() + " " + m.message + "\n"
}

// DoneMsg signals the spinner is done
type DoneMsg struct{}

// ErrorMsg signals an error occurred
type ErrorMsg struct {
	Err error
}

// =============================================================================
// Select Model (for picking from a list)
// =============================================================================

type SelectModel struct {
	title    string
	items    []string
	cursor   int
	selected string
	quitting bool
}

func NewSelect(title string, items []string) SelectModel {
	return SelectModel{
		title:  title,
		items:  items,
		cursor: 0,
	}
}

func (m SelectModel) Init() tea.Cmd {
	return nil
}

func (m SelectModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.quitting = true
			return m, tea.Quit

		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}

		case "down", "j":
			if m.cursor < len(m.items)-1 {
				m.cursor++
			}

		case "enter", " ":
			m.selected = m.items[m.cursor]
			return m, tea.Quit
		}
	}

	return m, nil
}

func (m SelectModel) View() string {
	if m.quitting {
		return ""
	}

	var b strings.Builder
	b.WriteString(titleStyle.Render(m.title))
	b.WriteString("\n\n")

	for i, item := range m.items {
		cursor := "  "
		style := lipgloss.NewStyle()

		if m.cursor == i {
			cursor = "> "
			style = selectedStyle
		}

		b.WriteString(cursor + style.Render(item) + "\n")
	}

	b.WriteString("\n" + dimStyle.Render("↑/↓ to move, enter to select, q to quit"))

	return b.String()
}

func (m SelectModel) Selected() string {
	return m.selected
}

// =============================================================================
// Table Helpers
// =============================================================================

func NewProjectsTable(data [][]string) table.Model {
	columns := []table.Column{
		{Title: "Name", Width: 25},
		{Title: "Ref", Width: 25},
		{Title: "Region", Width: 15},
		{Title: "Status", Width: 15},
	}

	rows := make([]table.Row, len(data))
	for i, d := range data {
		rows[i] = table.Row(d)
	}

	t := table.New(
		table.WithColumns(columns),
		table.WithRows(rows),
		table.WithFocused(true),
		table.WithHeight(10),
	)

	s := table.DefaultStyles()
	s.Header = s.Header.
		BorderStyle(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("240")).
		BorderBottom(true).
		Bold(false)
	s.Selected = s.Selected.
		Foreground(lipgloss.Color("229")).
		Background(lipgloss.Color("57")).
		Bold(false)
	t.SetStyles(s)

	return t
}

func NewBranchesTable(data [][]string) table.Model {
	columns := []table.Column{
		{Title: "Name", Width: 30},
		{Title: "Status", Width: 20},
		{Title: "Git Branch", Width: 25},
		{Title: "Default", Width: 8},
	}

	rows := make([]table.Row, len(data))
	for i, d := range data {
		rows[i] = table.Row(d)
	}

	t := table.New(
		table.WithColumns(columns),
		table.WithRows(rows),
		table.WithFocused(true),
		table.WithHeight(10),
	)

	s := table.DefaultStyles()
	s.Header = s.Header.
		BorderStyle(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("240")).
		BorderBottom(true).
		Bold(false)
	s.Selected = s.Selected.
		Foreground(lipgloss.Color("229")).
		Background(lipgloss.Color("57")).
		Bold(false)
	t.SetStyles(s)

	return t
}

// =============================================================================
// Progress Model
// =============================================================================

type ProgressModel struct {
	total    int
	current  int
	message  string
	quitting bool
}

func NewProgress(total int, message string) ProgressModel {
	return ProgressModel{
		total:   total,
		current: 0,
		message: message,
	}
}

func (m ProgressModel) Init() tea.Cmd {
	return nil
}

func (m ProgressModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.quitting = true
			return m, tea.Quit
		}

	case ProgressMsg:
		m.current = msg.Current
		m.message = msg.Message
		if m.current >= m.total {
			return m, tea.Quit
		}
	}

	return m, nil
}

func (m ProgressModel) View() string {
	if m.quitting {
		return dimStyle.Render("Cancelled\n")
	}

	percent := float64(m.current) / float64(m.total)
	width := 40
	filled := int(percent * float64(width))

	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)

	return fmt.Sprintf("%s [%s] %d/%d\n%s",
		infoStyle.Render("Progress:"),
		bar,
		m.current,
		m.total,
		m.message,
	)
}

type ProgressMsg struct {
	Current int
	Message string
}

// =============================================================================
// Helper Functions
// =============================================================================

// FormatStatus returns a styled status string
func FormatStatus(status string) string {
	switch status {
	case "ACTIVE_HEALTHY":
		return successStyle.Render("● Healthy")
	case "ACTIVE_UNHEALTHY":
		return errorStyle.Render("● Unhealthy")
	case "COMING_UP":
		return warningStyle.Render("● Starting")
	case "GOING_DOWN":
		return warningStyle.Render("● Stopping")
	case "INACTIVE", "PAUSED":
		return dimStyle.Render("○ Paused")
	default:
		return dimStyle.Render("○ " + status)
	}
}

// FormatBool returns a check or x for boolean
func FormatBool(b bool) string {
	if b {
		return successStyle.Render("✓")
	}
	return dimStyle.Render("✗")
}

// PrintSuccess prints a success message
func PrintSuccess(msg string) {
	fmt.Println(successStyle.Render("✓ " + msg))
}

// PrintError prints an error message
func PrintError(msg string) {
	fmt.Println(errorStyle.Render("✗ " + msg))
}

// PrintWarning prints a warning message
func PrintWarning(msg string) {
	fmt.Println(warningStyle.Render("⚠ " + msg))
}

// PrintInfo prints an info message
func PrintInfo(msg string) {
	fmt.Println(infoStyle.Render("ℹ " + msg))
}
