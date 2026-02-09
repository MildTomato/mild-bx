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

  // Environment Management
  // TODO: implement when API is available

  /**
   * List all environments for a project
   */
  async listEnvironments(projectRef: string): Promise<
    Array<{
      name: string;
      is_default: boolean;
      created_at?: string;
      variable_count?: number;
    }>
  > {
    // TODO: implement when API endpoint is available
    // Expected endpoint: GET /v1/projects/${projectRef}/environments
    throw new Error("Environment API not yet implemented");
  }

  /**
   * Create a new custom environment
   */
  async createEnvironment(
    projectRef: string,
    params: { name: string; from?: string },
  ): Promise<{ name: string; is_default: boolean }> {
    // TODO: implement when API endpoint is available
    // Expected endpoint: POST /v1/projects/${projectRef}/environments
    // Body: { name, from? }
    throw new Error("Environment API not yet implemented");
  }

  /**
   * Delete a custom environment
   */
  async deleteEnvironment(projectRef: string, name: string): Promise<void> {
    // TODO: implement when API endpoint is available
    // Expected endpoint: DELETE /v1/projects/${projectRef}/environments/${name}
    throw new Error("Environment API not yet implemented");
  }

  /**
   * Seed one environment from another
   */
  async seedEnvironment(
    projectRef: string,
    name: string,
    params: {
      from: string;
      variables?: Array<{ key: string; value: string; secret: boolean }>;
    },
  ): Promise<void> {
    // TODO: implement when API endpoint is available
    // Expected endpoint: POST /v1/projects/${projectRef}/environments/${name}/seed
    // Body: { from, variables? }
    throw new Error("Environment API not yet implemented");
  }

  /**
   * List environment variables for an environment
   */
  async listEnvVariables(
    projectRef: string,
    envName: string,
    options?: { branch?: string; decrypt?: boolean },
  ): Promise<Array<{ key: string; value: string; secret: boolean }>> {
    // TODO: implement when API endpoint is available
    // Expected endpoint: GET /v1/projects/${projectRef}/environments/${envName}/variables
    // Query params: branch?, decrypt?
    throw new Error("Environment API not yet implemented");
  }

  /**
   * Bulk upsert environment variables
   */
  async bulkUpsertEnvVariables(
    projectRef: string,
    envName: string,
    params: {
      variables: Array<{ key: string; value: string; secret: boolean }>;
      prune?: boolean;
    },
  ): Promise<void> {
    // TODO: implement when API endpoint is available
    // Expected endpoint: PUT /v1/projects/${projectRef}/environments/${envName}/variables
    // Body: { variables, prune? }
    throw new Error("Environment API not yet implemented");
  }

  /**
   * Set a single environment variable
   */
  async setEnvVariable(
    projectRef: string,
    envName: string,
    params: {
      key: string;
      value: string;
      secret?: boolean;
      branch?: string;
    },
  ): Promise<void> {
    // TODO: implement when API endpoint is available
    // Expected endpoint: PUT /v1/projects/${projectRef}/environments/${envName}/variables/${key}
    // Body: { value, secret?, branch? }
    throw new Error("Environment API not yet implemented");
  }

  /**
   * Delete a single environment variable
   */
  async deleteEnvVariable(
    projectRef: string,
    envName: string,
    key: string,
    options?: { branch?: string },
  ): Promise<void> {
    // TODO: implement when API endpoint is available
    // Expected endpoint: DELETE /v1/projects/${projectRef}/environments/${envName}/variables/${key}
    // Query params: branch?
    throw new Error("Environment API not yet implemented");
  }
}

export function createClient(token: string): SupabaseClient {
  return new SupabaseClient(token);
}
