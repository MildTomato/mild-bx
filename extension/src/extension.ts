import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";

// Path to the CLI binary (configurable)
const CLI_PATH = process.env.SUPA_CLI_PATH || "supa";

// Global state
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let projectsProvider: ProjectsTreeProvider;
let watchProcess: ChildProcess | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log("Supabase DX extension is now active");

  // Create output channel
  outputChannel = vscode.window.createOutputChannel("Supabase DX");

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "supabase-dx.showMenu";
  statusBarItem.text = "$(database) Supabase";
  statusBarItem.tooltip = "Supabase DX - Click for options";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Create tree view provider
  projectsProvider = new ProjectsTreeProvider();
  const treeView = vscode.window.createTreeView("supabaseDxProjects", {
    treeDataProvider: projectsProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("supabase-dx.login", () => login()),
    vscode.commands.registerCommand("supabase-dx.pull", () =>
      runCommand("pull"),
    ),
    vscode.commands.registerCommand("supabase-dx.push", () =>
      runCommand("push"),
    ),
    vscode.commands.registerCommand("supabase-dx.watch", () => startWatch()),
    vscode.commands.registerCommand("supabase-dx.stopWatch", () => stopWatch()),
    vscode.commands.registerCommand("supabase-dx.generateTypes", () =>
      runCommand("pull", ["--types-only"]),
    ),
    vscode.commands.registerCommand("supabase-dx.showMenu", () => showMenu()),
    vscode.commands.registerCommand("supabase-dx.refresh", () =>
      projectsProvider.refresh(),
    ),
    vscode.commands.registerCommand("supabase-dx.openProject", (ref: string) =>
      openProject(ref),
    ),
  );

  // Initial status update
  updateStatus();
}

export function deactivate() {
  stopWatch();
}

// =============================================================================
// Commands
// =============================================================================

async function login(): Promise<void> {
  const token = await vscode.window.showInputBox({
    prompt: "Enter your Supabase Personal Access Token",
    placeHolder: "sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    password: true,
    ignoreFocusOut: true,
  });

  if (!token) {
    return;
  }

  // Validate token by listing projects
  try {
    const result = await executeCli("projects", ["--json"]);
    const parsed = JSON.parse(result.stdout);

    if (parsed.status === "error") {
      vscode.window.showErrorMessage(
        `Login failed: ${parsed.error || parsed.message}`,
      );
      return;
    }

    // Store token in global config
    // The CLI handles this, so we just need to set the env var for this session
    process.env.SUPABASE_ACCESS_TOKEN = token;

    vscode.window.showInformationMessage(
      `Logged in successfully! Found ${parsed.projects?.length || 0} projects.`,
    );

    // Refresh the tree view
    projectsProvider.refresh();
    updateStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Login failed: ${message}`);
  }
}

async function runCommand(
  command: string,
  extraArgs: string[] = [],
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  outputChannel.show();
  outputChannel.appendLine(`\n${"=".repeat(60)}`);
  outputChannel.appendLine(
    `Running: supa ${command} ${extraArgs.join(" ")} --json`,
  );
  outputChannel.appendLine("=".repeat(60));

  try {
    const args = [command, "--json", ...extraArgs];
    const result = await executeCli(
      command,
      ["--json", ...extraArgs],
      workspaceFolder.uri.fsPath,
    );

    // Parse JSON output
    try {
      const parsed = JSON.parse(result.stdout);
      outputChannel.appendLine(JSON.stringify(parsed, null, 2));

      if (parsed.status === "error") {
        vscode.window.showErrorMessage(
          parsed.message || parsed.error || `${command} failed`,
        );
      } else if (parsed.status === "success") {
        vscode.window.showInformationMessage(
          parsed.message || `${command} completed successfully`,
        );
        // Refresh tree view after successful operation
        projectsProvider.refresh();
      } else {
        vscode.window.showInformationMessage(
          parsed.message || `${command} completed`,
        );
      }
    } catch {
      // Not JSON, show raw output
      outputChannel.appendLine(result.stdout);
      vscode.window.showInformationMessage(`${command} completed`);
    }

    if (result.stderr) {
      outputChannel.appendLine("\nStderr:");
      outputChannel.appendLine(result.stderr);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`Error: ${message}`);
    vscode.window.showErrorMessage(`Failed to run supa ${command}: ${message}`);
  }
}

async function startWatch(): Promise<void> {
  if (watchProcess) {
    vscode.window.showWarningMessage("Watch mode is already running");
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  outputChannel.show();
  outputChannel.appendLine("\n" + "=".repeat(60));
  outputChannel.appendLine("Starting watch mode...");
  outputChannel.appendLine("=".repeat(60));

  try {
    watchProcess = spawn(CLI_PATH, ["watch", "--json"], {
      cwd: workspaceFolder.uri.fsPath,
      env: { ...process.env },
    });

    watchProcess.stdout?.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          handleWatchEvent(event);
        } catch {
          outputChannel.appendLine(line);
        }
      }
    });

    watchProcess.stderr?.on("data", (data) => {
      outputChannel.appendLine(`[stderr] ${data.toString()}`);
    });

    watchProcess.on("close", (code) => {
      outputChannel.appendLine(`Watch process exited with code ${code}`);
      watchProcess = null;
      updateStatus();
    });

    watchProcess.on("error", (err) => {
      outputChannel.appendLine(`Watch error: ${err.message}`);
      vscode.window.showErrorMessage(`Watch failed: ${err.message}`);
      watchProcess = null;
      updateStatus();
    });

    updateStatus();
    vscode.window.showInformationMessage("Watch mode started");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to start watch: ${message}`);
  }
}

function stopWatch(): void {
  if (watchProcess) {
    watchProcess.kill();
    watchProcess = null;
    updateStatus();
    vscode.window.showInformationMessage("Watch mode stopped");
  }
}

function handleWatchEvent(event: any): void {
  outputChannel.appendLine(JSON.stringify(event));

  switch (event.event) {
    case "types_updated":
      vscode.window.showInformationMessage("TypeScript types updated");
      break;
    case "profile_changed":
      vscode.window.showInformationMessage(
        `Switched to profile: ${event.profile}`,
      );
      updateStatus();
      break;
    case "branch_changed":
      statusBarItem.text = `$(git-branch) ${event.branch}`;
      break;
  }
}

async function showMenu(): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    { label: "$(arrow-down) Pull", description: "Pull remote state to local" },
    { label: "$(arrow-up) Push", description: "Push local changes to remote" },
    { label: "$(eye) Start Watch", description: "Watch for changes" },
    { label: "$(primitive-square) Stop Watch", description: "Stop watch mode" },
    {
      label: "$(symbol-interface) Generate Types",
      description: "Generate TypeScript types",
    },
    { label: "$(refresh) Refresh", description: "Refresh project list" },
    { label: "$(key) Login", description: "Login with access token" },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a Supabase DX action",
  });

  if (!selected) return;

  switch (selected.label) {
    case "$(arrow-down) Pull":
      vscode.commands.executeCommand("supabase-dx.pull");
      break;
    case "$(arrow-up) Push":
      vscode.commands.executeCommand("supabase-dx.push");
      break;
    case "$(eye) Start Watch":
      vscode.commands.executeCommand("supabase-dx.watch");
      break;
    case "$(primitive-square) Stop Watch":
      vscode.commands.executeCommand("supabase-dx.stopWatch");
      break;
    case "$(symbol-interface) Generate Types":
      vscode.commands.executeCommand("supabase-dx.generateTypes");
      break;
    case "$(refresh) Refresh":
      vscode.commands.executeCommand("supabase-dx.refresh");
      break;
    case "$(key) Login":
      vscode.commands.executeCommand("supabase-dx.login");
      break;
  }
}

async function openProject(ref: string): Promise<void> {
  const url = `https://supabase.com/dashboard/project/${ref}`;
  vscode.env.openExternal(vscode.Uri.parse(url));
}

function updateStatus(): void {
  if (watchProcess) {
    statusBarItem.text = "$(eye) Supabase (watching)";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
  } else {
    statusBarItem.text = "$(database) Supabase";
    statusBarItem.backgroundColor = undefined;
  }
}

// =============================================================================
// Tree View Provider
// =============================================================================

class ProjectsTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: any[] = [];
  private functions: Map<string, any[]> = new Map();
  private branches: Map<string, any[]> = new Map();

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      // Root level - get projects
      return this.getProjects();
    }

    switch (element.contextValue) {
      case "project":
        return this.getProjectChildren(element.id!);
      case "functions-folder":
        return this.getFunctions(element.projectRef!);
      case "branches-folder":
        return this.getBranches(element.projectRef!);
      default:
        return [];
    }
  }

  private async getProjects(): Promise<TreeItem[]> {
    try {
      const result = await executeCli("projects", ["--json"]);
      const parsed = JSON.parse(result.stdout);

      if (parsed.status === "error") {
        return [
          new TreeItem(
            "Login required",
            vscode.TreeItemCollapsibleState.None,
            "error",
          ),
        ];
      }

      this.projects = parsed.projects || [];

      return this.projects.map((p) => {
        const item = new TreeItem(
          p.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          "project",
        );
        item.id = p.ref || p.id;
        item.description = p.region;
        item.tooltip = `${p.name} (${p.ref || p.id})\nRegion: ${p.region}\nStatus: ${p.status}`;
        item.iconPath = new vscode.ThemeIcon("database");
        item.contextValue = "project";
        return item;
      });
    } catch (error) {
      return [
        new TreeItem(
          "Failed to load projects",
          vscode.TreeItemCollapsibleState.None,
          "error",
        ),
      ];
    }
  }

  private getProjectChildren(projectRef: string): TreeItem[] {
    const functionsFolder = new TreeItem(
      "Functions",
      vscode.TreeItemCollapsibleState.Collapsed,
      "functions-folder",
    );
    functionsFolder.iconPath = new vscode.ThemeIcon("symbol-function");
    functionsFolder.projectRef = projectRef;

    const branchesFolder = new TreeItem(
      "Branches",
      vscode.TreeItemCollapsibleState.Collapsed,
      "branches-folder",
    );
    branchesFolder.iconPath = new vscode.ThemeIcon("git-branch");
    branchesFolder.projectRef = projectRef;

    const openDashboard = new TreeItem(
      "Open Dashboard",
      vscode.TreeItemCollapsibleState.None,
      "action",
    );
    openDashboard.iconPath = new vscode.ThemeIcon("link-external");
    openDashboard.command = {
      command: "supabase-dx.openProject",
      title: "Open Dashboard",
      arguments: [projectRef],
    };

    return [functionsFolder, branchesFolder, openDashboard];
  }

  private async getFunctions(projectRef: string): Promise<TreeItem[]> {
    // For now, return placeholder - would need CLI support for per-project functions
    return [
      new TreeItem(
        "(run pull to fetch)",
        vscode.TreeItemCollapsibleState.None,
        "info",
      ),
    ];
  }

  private async getBranches(projectRef: string): Promise<TreeItem[]> {
    // For now, return placeholder - would need CLI support for per-project branches
    return [
      new TreeItem(
        "(run pull to fetch)",
        vscode.TreeItemCollapsibleState.None,
        "info",
      ),
    ];
  }
}

class TreeItem extends vscode.TreeItem {
  projectRef?: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue?: string,
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
  }
}

// =============================================================================
// CLI Execution
// =============================================================================

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function executeCli(
  command: string,
  args: string[] = [],
  cwd?: string,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const allArgs = [command, ...args];
    const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const proc = spawn(CLI_PATH, allArgs, {
      cwd: workDir,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `CLI not found at "${CLI_PATH}". Make sure supa is installed and in your PATH.`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}
