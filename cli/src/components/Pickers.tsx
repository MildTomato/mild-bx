/**
 * Reusable picker components for Ink UI
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { Spinner, Status } from "./Spinner.js";
import { createClient, type Organization, type Project } from "../lib/api.js";
import { getAccessToken } from "../lib/config.js";
import { REGIONS, type Region } from "../lib/constants.js";

// Generic choice picker
interface ChoicePickerProps {
  title: string;
  choices: Array<{ key: string; label: string; value: string }>;
  onSelect: (value: string) => void;
}

export function ChoicePicker({ title, choices, onSelect }: ChoicePickerProps) {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        {title}
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={choices}
          onSelect={(item) => onSelect(item.value)}
        />
      </Box>
    </Box>
  );
}

// Organization picker
interface OrgPickerProps {
  onSelect: (org: Organization) => void;
  onError?: (error: string) => void;
}

export function OrgPicker({ onSelect, onError }: OrgPickerProps) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrgs();
  }, []);

  async function loadOrgs() {
    const token = getAccessToken();
    if (!token) {
      const msg = "Not authenticated";
      setError(msg);
      onError?.(msg);
      setLoading(false);
      return;
    }

    try {
      const client = createClient(token);
      const organizations = await client.listOrganizations();
      setOrgs(organizations);

      // Auto-select if only one
      if (organizations.length === 1) {
        onSelect(organizations[0]);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load organizations";
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <Spinner message="Loading organizations..." />;
  }

  if (error) {
    return <Status type="error" message={error} />;
  }

  if (orgs.length === 0) {
    return <Status type="warning" message="No organizations found" />;
  }

  // Already auto-selected if only one
  if (orgs.length === 1) {
    return null;
  }

  const items = orgs.map((org) => ({
    key: org.slug,
    label: org.name,
    value: org,
  }));

  // Custom item renderer to dim the slug
  const OrgItem = ({
    isSelected,
    label,
    value,
  }: {
    isSelected: boolean;
    label: string;
    value: Organization;
  }) => (
    <Text color={isSelected ? "cyan" : undefined}>
      {label} <Text dimColor>({value.slug})</Text>
    </Text>
  );

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        Select organization:
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value)}
          itemComponent={OrgItem}
        />
      </Box>
    </Box>
  );
}

// Project picker
interface ProjectPickerProps {
  orgSlug?: string;
  onSelect: (project: Project) => void;
  onError?: (error: string) => void;
  onEmpty?: () => void;
}

export function ProjectPicker({
  orgSlug,
  onSelect,
  onError,
  onEmpty,
}: ProjectPickerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, [orgSlug]);

  async function loadProjects() {
    const token = getAccessToken();
    if (!token) {
      const msg = "Not authenticated";
      setError(msg);
      onError?.(msg);
      setLoading(false);
      return;
    }

    try {
      const client = createClient(token);
      const allProjects = await client.listProjects();
      const filtered = orgSlug
        ? allProjects.filter((p) => p.organization_slug === orgSlug)
        : allProjects;
      setProjects(filtered);

      if (filtered.length === 0) {
        onEmpty?.();
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load projects";
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <Spinner message="Loading projects..." />;
  }

  if (error) {
    return <Status type="error" message={error} />;
  }

  if (projects.length === 0) {
    return <Status type="info" message="No projects found" />;
  }

  const items = projects.map((p) => ({
    key: p.ref,
    label: `${p.name} (${p.ref}) - ${p.region}`,
    value: p,
  }));

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        Select project:
      </Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      </Box>
    </Box>
  );
}

// Region picker
interface RegionPickerProps {
  onSelect: (region: Region) => void;
  title?: string;
}

export function RegionPicker({
  onSelect,
  title = "Select region:",
}: RegionPickerProps) {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        {title}
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={REGIONS}
          onSelect={(item) => onSelect(item.value)}
        />
      </Box>
    </Box>
  );
}

// Create or select choice
interface CreateOrSelectProps {
  entityName: string; // "organization" or "project"
  existingCount: number;
  existingNames?: string[]; // Show first few names for context
  onChoice: (choice: "existing" | "new") => void;
}

export function CreateOrSelectChoice({
  entityName,
  existingCount,
  existingNames,
  onChoice,
}: CreateOrSelectProps) {
  const hasExisting = existingCount > 0;
  const [highlighted, setHighlighted] = useState<"existing" | "new">(
    "existing",
  );

  const items = hasExisting
    ? [
        {
          key: "existing",
          label: `Use existing ${entityName}`,
          value: "existing" as const,
        },
        {
          key: "new",
          label: `Create new ${entityName}`,
          value: "new" as const,
        },
      ]
    : [
        {
          key: "new",
          label: `Create new ${entityName}`,
          value: "new" as const,
        },
      ];

  // Build context message based on highlighted item
  let contextMsg = "";
  if (highlighted === "existing" && hasExisting) {
    if (existingNames && existingNames.length > 0) {
      const displayNames = existingNames.slice(0, 3);
      const more = existingCount > 3 ? ` (+${existingCount - 3} more)` : "";
      contextMsg = `You have ${existingCount} ${entityName}${existingCount > 1 ? "s" : ""}: ${displayNames.join(", ")}${more}`;
    } else {
      contextMsg = `You have ${existingCount} ${entityName}${existingCount > 1 ? "s" : ""}`;
    }
  } else if (highlighted === "new") {
    contextMsg = `Create a new ${entityName} for your project`;
  } else {
    contextMsg = `No ${entityName}s found in your account`;
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>{contextMsg}</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onChoice(item.value)}
          onHighlight={(item) => setHighlighted(item.value)}
        />
      </Box>
    </Box>
  );
}

// Text input for names (project, org, etc.)
interface NameInputProps {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  hint?: string;
  onSubmit: (value: string) => void;
}

export function NameInput({
  label,
  placeholder,
  defaultValue = "",
  hint,
  onSubmit,
}: NameInputProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      {hint && <Text dimColor>{hint}</Text>}
      <Box marginTop={1}>
        <Text color="cyan">{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          placeholder={placeholder}
          onSubmit={() => {
            const trimmed = value.trim();
            if (trimmed) {
              onSubmit(trimmed);
            }
          }}
        />
      </Box>
      <Text dimColor>Press Enter to confirm</Text>
    </Box>
  );
}
