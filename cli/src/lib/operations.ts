/**
 * Shared operations for creating projects and organizations
 * Used by both init command and standalone commands
 */

import {
  createClient,
  type Organization,
  type ProjectResponse,
} from "./api.js";
import { type Region } from "./constants.js";

export interface CreateProjectParams {
  token: string;
  orgSlug: string;
  region: Region;
  name?: string;
  dbPass?: string;
}

export interface CreateOrgParams {
  token: string;
  name?: string;
}

/**
 * Generate a unique project name
 */
export function generateProjectName(): string {
  return `project-${Date.now().toString(36)}`;
}

/**
 * Generate a secure database password (alphanumeric only)
 */
export function generateDbPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < 24; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Generate a unique organization name
 */
export function generateOrgName(): string {
  return `my-org-${Date.now().toString(36)}`;
}

export interface CreateProjectResult {
  project: ProjectResponse;
  dbPassword: string;
}

/**
 * Create a new project
 */
export async function createProject(
  params: CreateProjectParams,
): Promise<CreateProjectResult> {
  const { token, orgSlug, region, name, dbPass } = params;

  const client = createClient(token);
  const projectName = name || generateProjectName();
  const password = dbPass || generateDbPassword();

  const project = await client.createProject({
    name: projectName,
    organization_slug: orgSlug,
    region,
    db_pass: password,
  });

  return { project, dbPassword: password };
}

/**
 * Create a new organization
 */
export async function createOrganization(
  params: CreateOrgParams,
): Promise<Organization> {
  const { token, name } = params;

  const client = createClient(token);
  const orgName = name || generateOrgName();

  return client.createOrganization(orgName);
}
