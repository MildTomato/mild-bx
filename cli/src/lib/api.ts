/**
 * Supabase Management API Client
 * Types auto-generated from OpenAPI spec
 */

import type { components } from "./api-types.js";

// Re-export schema types for convenience
export type Project = components["schemas"]["V1ProjectWithDatabaseResponse"];
export type ProjectResponse = components["schemas"]["V1ProjectResponse"];
export type Branch = components["schemas"]["BranchResponse"];
export type BranchDetail = components["schemas"]["BranchDetailResponse"];
export type Function = components["schemas"]["FunctionResponse"];
export type FunctionSlug = components["schemas"]["FunctionSlugResponse"];
export type Secret = components["schemas"]["SecretResponse"];
export type Migration = components["schemas"]["V1GetMigrationResponse"];
export type MigrationList = components["schemas"]["V1ListMigrationsResponse"];
export type TypescriptResponse = components["schemas"]["TypescriptResponse"];
export type Organization = components["schemas"]["OrganizationResponseV1"];
export type CreateProjectBody = components["schemas"]["V1CreateProjectBody"];
export type CreateBranchBody = components["schemas"]["CreateBranchBody"];
export type ApiKey = components["schemas"]["ApiKeyResponse"];

const BASE_URL = "https://api.supabase.com";

export class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class SupabaseClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl = BASE_URL) {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new APIError(response.status, text || `HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json() as Promise<T>;
    }

    return response.text() as unknown as T;
  }

  // Projects
  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/v1/projects");
  }

  async getProject(projectRef: string): Promise<Project> {
    return this.request<Project>("GET", `/v1/projects/${projectRef}`);
  }

  async createProject(params: CreateProjectBody): Promise<ProjectResponse> {
    return this.request<ProjectResponse>("POST", "/v1/projects", params);
  }

  async deleteProject(projectRef: string): Promise<void> {
    await this.request("DELETE", `/v1/projects/${projectRef}`);
  }

  // Branches
  async listBranches(projectRef: string): Promise<Branch[]> {
    return this.request<Branch[]>("GET", `/v1/projects/${projectRef}/branches`);
  }

  async getBranch(projectRef: string, branchName: string): Promise<Branch> {
    return this.request<Branch>(
      "GET",
      `/v1/projects/${projectRef}/branches/${branchName}`,
    );
  }

  async getBranchConfig(branchRef: string): Promise<BranchDetail> {
    return this.request<BranchDetail>("GET", `/v1/branches/${branchRef}`);
  }

  async createBranch(
    projectRef: string,
    params: CreateBranchBody,
  ): Promise<Branch> {
    return this.request<Branch>(
      "POST",
      `/v1/projects/${projectRef}/branches`,
      params,
    );
  }

  async deleteBranch(branchRef: string, force = true): Promise<void> {
    const query = force ? "" : "?force=false";
    await this.request("DELETE", `/v1/branches/${branchRef}${query}`);
  }

  async getBranchDiff(branchRef: string, schemas = "public"): Promise<string> {
    const params = new URLSearchParams({ included_schemas: schemas });
    return this.request<string>(
      "GET",
      `/v1/branches/${branchRef}/diff?${params}`,
    );
  }

  // TypeScript Types
  async getTypescriptTypes(
    projectRef: string,
    schemas = "public",
  ): Promise<TypescriptResponse> {
    const params = new URLSearchParams({ included_schemas: schemas });
    return this.request<TypescriptResponse>(
      "GET",
      `/v1/projects/${projectRef}/types/typescript?${params}`,
    );
  }

  // Functions
  async listFunctions(projectRef: string): Promise<Function[]> {
    return this.request<Function[]>(
      "GET",
      `/v1/projects/${projectRef}/functions`,
    );
  }

  async getFunction(
    projectRef: string,
    functionSlug: string,
  ): Promise<FunctionSlug> {
    return this.request<FunctionSlug>(
      "GET",
      `/v1/projects/${projectRef}/functions/${functionSlug}`,
    );
  }

  async deleteFunction(
    projectRef: string,
    functionSlug: string,
  ): Promise<void> {
    await this.request(
      "DELETE",
      `/v1/projects/${projectRef}/functions/${functionSlug}`,
    );
  }

  // Secrets
  async listSecrets(projectRef: string): Promise<Secret[]> {
    return this.request<Secret[]>("GET", `/v1/projects/${projectRef}/secrets`);
  }

  async createSecrets(
    projectRef: string,
    secrets: Array<{ name: string; value: string }>,
  ): Promise<void> {
    await this.request("POST", `/v1/projects/${projectRef}/secrets`, secrets);
  }

  async deleteSecrets(projectRef: string, names: string[]): Promise<void> {
    await this.request("DELETE", `/v1/projects/${projectRef}/secrets`, names);
  }

  // API Keys
  async getProjectApiKeys(
    projectRef: string,
    reveal = true,
  ): Promise<ApiKey[]> {
    const params = reveal ? "?reveal=true" : "";
    return this.request<ApiKey[]>(
      "GET",
      `/v1/projects/${projectRef}/api-keys${params}`,
    );
  }

  // Migrations
  async listMigrations(projectRef: string): Promise<MigrationList> {
    return this.request<MigrationList>(
      "GET",
      `/v1/projects/${projectRef}/database/migrations`,
    );
  }

  async getMigration(projectRef: string, version: string): Promise<Migration> {
    return this.request<Migration>(
      "GET",
      `/v1/projects/${projectRef}/database/migrations/${version}`,
    );
  }

  async applyMigration(
    projectRef: string,
    query: string,
    name?: string,
    rollback?: string,
  ): Promise<void> {
    await this.request(
      "POST",
      `/v1/projects/${projectRef}/database/migrations`,
      {
        query,
        name,
        rollback,
      },
    );
  }

  // Database Query
  async runQuery(projectRef: string, query: string): Promise<unknown> {
    return this.request("POST", `/v1/projects/${projectRef}/database/query`, {
      query,
    });
  }

  async runReadOnlyQuery(projectRef: string, query: string): Promise<unknown> {
    return this.request(
      "POST",
      `/v1/projects/${projectRef}/database/query/read-only`,
      {
        query,
      },
    );
  }

  // Organizations
  async listOrganizations(): Promise<Organization[]> {
    return this.request<Organization[]>("GET", "/v1/organizations");
  }

  async createOrganization(name: string): Promise<Organization> {
    return this.request<Organization>("POST", "/v1/organizations", { name });
  }

  // Health
  async getProjectHealth(
    projectRef: string,
    services: string[],
  ): Promise<components["schemas"]["V1ServiceHealthResponse"][]> {
    const params = new URLSearchParams();
    services.forEach((s) => params.append("services", s));
    return this.request("GET", `/v1/projects/${projectRef}/health?${params}`);
  }

  // Config Updates
  async updatePostgrestConfig(
    projectRef: string,
    config: components["schemas"]["V1UpdatePostgrestConfigBody"],
  ): Promise<components["schemas"]["V1PostgrestConfigResponse"]> {
    return this.request(
      "PATCH",
      `/v1/projects/${projectRef}/postgrest`,
      config,
    );
  }

  async getPostgrestConfig(
    projectRef: string,
  ): Promise<components["schemas"]["PostgrestConfigWithJWTSecretResponse"]> {
    return this.request("GET", `/v1/projects/${projectRef}/postgrest`);
  }

  async updateAuthConfig(
    projectRef: string,
    config: components["schemas"]["UpdateAuthConfigBody"],
  ): Promise<components["schemas"]["AuthConfigResponse"]> {
    return this.request(
      "PATCH",
      `/v1/projects/${projectRef}/config/auth`,
      config,
    );
  }

  async getAuthConfig(
    projectRef: string,
  ): Promise<components["schemas"]["AuthConfigResponse"]> {
    return this.request("GET", `/v1/projects/${projectRef}/config/auth`);
  }

  // Database connection info
  async getPoolerConfig(
    projectRef: string,
  ): Promise<components["schemas"]["SupavisorConfigResponse"][]> {
    return this.request(
      "GET",
      `/v1/projects/${projectRef}/config/database/pooler`,
    );
  }

  // Update database password
  async updateDatabasePassword(
    projectRef: string,
    password: string,
  ): Promise<components["schemas"]["V1UpdatePasswordResponse"]> {
    return this.request(
      "PATCH",
      `/v1/projects/${projectRef}/database/password`,
      { password },
    );
  }
}

export function createClient(token: string): SupabaseClient {
  return new SupabaseClient(token);
}
