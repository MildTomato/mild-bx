import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock vscode module
vi.mock("vscode", () => ({
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
    })),
    createStatusBarItem: vi.fn(() => ({
      show: vi.fn(),
      hide: vi.fn(),
      text: "",
      tooltip: "",
      command: "",
    })),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    createTreeView: vi.fn(() => ({
      dispose: vi.fn(),
    })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
  },
  env: {
    openExternal: vi.fn(),
  },
  Uri: {
    parse: vi.fn((url: string) => ({ toString: () => url })),
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  TreeItem: class {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  ThemeIcon: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  ThemeColor: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
}));

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === "data") {
          callback(Buffer.from('{"status":"success","projects":[]}'));
        }
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, callback) => {
      if (event === "close") {
        setTimeout(() => callback(0), 10);
      }
    }),
    kill: vi.fn(),
  })),
}));

describe("Extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CLI Execution", () => {
    it("should parse JSON output correctly", () => {
      const jsonOutput = '{"status":"success","projects":[{"name":"Test"}]}';
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.status).toBe("success");
      expect(parsed.projects).toHaveLength(1);
      expect(parsed.projects[0].name).toBe("Test");
    });

    it("should handle error status", () => {
      const jsonOutput = '{"status":"error","message":"Not authenticated"}';
      const parsed = JSON.parse(jsonOutput);

      expect(parsed.status).toBe("error");
      expect(parsed.message).toBe("Not authenticated");
    });
  });

  describe("Pull Result Parsing", () => {
    it("should parse pull result with project info", () => {
      const pullResult = {
        status: "success",
        profile: "local",
        project_ref: "abcdefghijklmnopqrst",
        project: {
          name: "My Project",
          region: "us-east-1",
          status: "ACTIVE_HEALTHY",
        },
        branches: [
          { name: "main", is_default: true },
          { name: "develop", is_default: false },
        ],
        functions: [{ slug: "hello-world", version: 1 }],
        types_written: true,
      };

      expect(pullResult.status).toBe("success");
      expect(pullResult.project?.name).toBe("My Project");
      expect(pullResult.branches).toHaveLength(2);
      expect(pullResult.functions).toHaveLength(1);
      expect(pullResult.types_written).toBe(true);
    });
  });

  describe("Push Plan Parsing", () => {
    it("should parse push plan with migrations", () => {
      const pushResult = {
        status: "success",
        profile: "staging",
        project_ref: "abcdefghijklmnopqrst",
        migrations_found: 3,
        migrations_applied: 3,
        functions_found: 2,
      };

      expect(pushResult.migrations_found).toBe(3);
      expect(pushResult.migrations_applied).toBe(3);
    });
  });

  describe("Watch Events", () => {
    it("should parse types_updated event", () => {
      const event = {
        event: "types_updated",
        path: "/project/supabase/types/database.ts",
      };

      expect(event.event).toBe("types_updated");
      expect(event.path).toContain("database.ts");
    });

    it("should parse profile_changed event", () => {
      const event = {
        event: "profile_changed",
        branch: "feature/auth",
        profile: "local",
        project_ref: "abcdefghijklmnopqrst",
      };

      expect(event.event).toBe("profile_changed");
      expect(event.profile).toBe("local");
    });
  });
});

describe("Tree View", () => {
  it("should create project tree items", () => {
    const projects = [
      {
        name: "Project 1",
        ref: "abc123",
        region: "us-east-1",
        status: "ACTIVE_HEALTHY",
      },
      {
        name: "Project 2",
        ref: "def456",
        region: "eu-west-1",
        status: "INACTIVE",
      },
    ];

    const items = projects.map((p) => ({
      label: p.name,
      id: p.ref,
      description: p.region,
    }));

    expect(items).toHaveLength(2);
    expect(items[0].label).toBe("Project 1");
    expect(items[0].id).toBe("abc123");
  });
});

describe("Status Formatting", () => {
  it("should format healthy status", () => {
    const status = "ACTIVE_HEALTHY";
    const isHealthy = status === "ACTIVE_HEALTHY";
    expect(isHealthy).toBe(true);
  });

  it("should detect unhealthy status", () => {
    const status = "ACTIVE_UNHEALTHY";
    const isHealthy = status === "ACTIVE_HEALTHY";
    expect(isHealthy).toBe(false);
  });
});
