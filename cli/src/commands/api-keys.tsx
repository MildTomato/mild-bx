/**
 * API Keys command - list and manage project API keys
 */

import React, { useState, useEffect } from 'react';
import { render, Text, Box, useApp } from 'ink';
import { Spinner, Status } from '../components/Spinner.js';
import { Table } from '../components/Table.js';
import { createClient, type ApiKey } from '../lib/api.js';
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
} from '../lib/config.js';
import { getCurrentBranch } from '../lib/git.js';
import { C } from '../lib/colors.js';

interface ApiKeysOptions {
  profile?: string;
  json?: boolean;
  reveal?: boolean;
}

// Format key type for display
function formatKeyType(type: string | null | undefined): string {
  if (!type) return 'unknown';
  switch (type) {
    case 'legacy':
      return `${C.secondary}legacy${C.reset}`;
    case 'publishable':
      return `${C.success}publishable${C.reset}`;
    case 'secret':
      return `${C.warning}secret${C.reset}`;
    default:
      return type;
  }
}

// Mask API key for display (show prefix only)
function maskApiKey(key: string | null | undefined, reveal: boolean): string {
  if (!key) return '-';
  if (reveal) return key;
  // Show first 20 chars + masked rest
  if (key.length > 24) {
    return key.slice(0, 20) + '...' + key.slice(-4);
  }
  return key;
}

// List API keys UI
function ApiKeysListUI({
  projectRef,
  reveal,
}: {
  projectRef: string;
  reveal: boolean;
}) {
  const { exit } = useApp();
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadApiKeys();
  }, []);

  async function loadApiKeys() {
    const token = getAccessToken();
    if (!token) {
      setError('Not logged in');
      setLoading(false);
      setTimeout(() => exit(), 100);
      return;
    }

    try {
      const client = createClient(token);
      const keys = await client.getProjectApiKeys(projectRef, reveal);
      setApiKeys(keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
      setTimeout(() => exit(), 100);
    }
  }

  if (loading) {
    return (
      <Box padding={1}>
        <Spinner message="Loading API keys..." />
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding={1}>
        <Status type="error" message={error} />
      </Box>
    );
  }

  if (apiKeys.length === 0) {
    return (
      <Box padding={1}>
        <Status type="info" message="No API keys found" />
      </Box>
    );
  }

  const tableData = apiKeys.map((key) => ({
    name: key.name,
    type: formatKeyType(key.type),
    prefix: key.prefix || '-',
    key: maskApiKey(key.api_key, reveal),
    created: key.inserted_at
      ? new Date(key.inserted_at).toLocaleDateString()
      : '-',
  }));

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magenta">
        API Keys for {projectRef}
      </Text>
      <Box marginTop={1}>
        <Table
          columns={[
            { key: 'name', header: 'Name', width: 20 },
            { key: 'type', header: 'Type', width: 15 },
            { key: 'prefix', header: 'Prefix', width: 15 },
            { key: 'key', header: 'Key', width: 40 },
            { key: 'created', header: 'Created', width: 12 },
          ]}
          data={tableData}
        />
      </Box>
      {!reveal && (
        <Box marginTop={1}>
          <Text dimColor>Tip: Use --reveal to show full API keys</Text>
        </Box>
      )}
    </Box>
  );
}

export async function apiKeysCommand(options: ApiKeysOptions): Promise<void> {
  const token = getAccessToken();

  if (!token) {
    if (options.json) {
      console.log(
        JSON.stringify({ status: 'error', message: 'Not logged in' })
      );
    } else {
      console.error(
        'Not logged in. Set SUPABASE_ACCESS_TOKEN environment variable.'
      );
    }
    return;
  }

  // Get project ref from config
  const cwd = process.cwd();
  const config = loadProjectConfig(cwd);

  if (!config) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: 'error',
          message: 'No supabase/config.json found',
        })
      );
    } else {
      console.error('No supabase/config.json found. Run `supa init` first.');
    }
    return;
  }

  const branch = getCurrentBranch(cwd) || 'main';
  const profile = getProfileOrAuto(config, options.profile, branch);
  const projectRef = getProjectRef(config, profile);

  if (!projectRef) {
    if (options.json) {
      console.log(
        JSON.stringify({
          status: 'error',
          message: 'No project ref configured',
        })
      );
    } else {
      console.error('No project ref configured. Run `supa init` first.');
    }
    return;
  }

  const reveal = options.reveal ?? false;

  // JSON mode
  if (options.json) {
    try {
      const client = createClient(token);
      const apiKeys = await client.getProjectApiKeys(projectRef, reveal);
      console.log(JSON.stringify({ status: 'success', project_ref: projectRef, api_keys: apiKeys }));
    } catch (error) {
      console.log(
        JSON.stringify({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Failed to load API keys',
        })
      );
    }
    return;
  }

  // Interactive mode
  render(<ApiKeysListUI projectRef={projectRef} reveal={reveal} />);
}
