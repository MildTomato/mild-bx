/**
 * Dev command - watch for schema and config changes and sync to remote
 * 
 * Similar to `supa push` but runs continuously, watching for changes
 * and automatically applying them.
 */

import { watch as chokidarWatch } from 'chokidar';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { createClient } from '../lib/api.js';
import {
  getAccessToken,
  loadProjectConfig,
  getProfileOrAuto,
  getProjectRef,
  getProfileForBranch,
  type Profile,
} from '../lib/config.js';
import { getCurrentBranch } from '../lib/git.js';
import { diffSchemaWithPgDelta, applySchemaWithPgDelta, applySeedFiles, findSeedFiles, setVerbose, closeSupabasePool } from '../lib/pg-delta.js';
import { getSeedConfig } from '../lib/seed-config.js';
import { C } from '../lib/colors.js';
import { 
  buildPostgrestPayload, 
  buildAuthPayload,
  compareConfigs,
  type ProjectConfig,
  type ConfigDiff,
} from '../lib/sync.js';


// Spinner frames (same as ink-spinner dots)
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HEARTBEAT_FRAMES = ['⠏', '⠇', '⠧', '⠦', '⠴', '⠼', '⠸', '⠹', '⠙', '⠋'];

interface DevOptions {
  profile?: string;
  debounce?: string;
  noBranchWatch?: boolean;
  typesInterval?: string;
  json?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  seed?: boolean;
  noSeed?: boolean;
}

interface DevState {
  profile?: Profile;
  projectRef?: string;
  connectionString?: string;
  pendingSchemaChanges: Set<string>;
  pendingConfigChange: boolean;
  pendingSeedChange: boolean;
  lastPush: number;
  isApplying: boolean;
  seedApplied: boolean;
}

export async function devCommand(options: DevOptions): Promise<void> {
  const cwd = process.cwd();
  const schemaDir = join(cwd, 'supabase', 'schema');

  // Set verbose mode for pg-delta logging
  setVerbose(options.verbose ?? false);

  // Parse debounce interval
  let debounceMs = 500; // default 500ms
  if (options.debounce) {
    const match = options.debounce.match(/^(\d+)(ms|s)?$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || 'ms';
      debounceMs = value * (unit === 's' ? 1000 : 1);
    }
  }

  // Parse types interval
  let typesIntervalMs = 30000; // default 30s
  if (options.typesInterval) {
    const match = options.typesInterval.match(/^(\d+)(s|m)?$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || 's';
      typesIntervalMs = value * (unit === 'm' ? 60000 : 1000);
    }
  }

  // Load config
  const config = loadProjectConfig(cwd);
  if (!config) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'No config found' }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} No supabase/config.json found`);
      console.error(`  Run ${C.value}supa init${C.reset} to initialize\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Get token
  const token = getAccessToken();
  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'Not authenticated' }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} Not authenticated`);
      console.error(`  Set SUPABASE_ACCESS_TOKEN environment variable\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Check for db password
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'SUPABASE_DB_PASSWORD not set' }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} SUPABASE_DB_PASSWORD environment variable is required`);
      console.error(`  Get your database password from the Supabase dashboard\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Check schema directory exists
  if (!existsSync(schemaDir)) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'No schema directory' }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} No supabase/schema directory found`);
      console.error(`  Run ${C.value}supa schema pull${C.reset} to initialize\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Get current state
  let currentBranch = getCurrentBranch(cwd) || 'unknown';
  let profile = getProfileOrAuto(config, options.profile, currentBranch);
  let projectRef = getProjectRef(config, profile);

  if (!projectRef) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'No project_id configured' }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} No project_id configured`);
      console.error(`  Add "project_id" to supabase/config.json\n`);
    }
    process.exitCode = 1;
    return;
  }

  // Get connection string
  const client = createClient(token);

  // Check project status
  try {
    const project = await client.getProject(projectRef);
    if (project.status === 'INACTIVE') {
      if (options.json) {
        console.log(JSON.stringify({ 
          status: 'error', 
          message: 'Project is paused',
          hint: 'Restore the project from the Supabase dashboard',
          dashboardUrl: `https://supabase.com/dashboard/project/${projectRef}`
        }));
      } else {
        console.error(`\n${C.error}Error:${C.reset} Project is paused`);
        console.error(`  Restore from: ${C.value}https://supabase.com/dashboard/project/${projectRef}${C.reset}\n`);
      }
      process.exitCode = 1;
      return;
    }
    if (project.status !== 'ACTIVE_HEALTHY' && project.status !== 'ACTIVE_UNHEALTHY') {
      if (options.json) {
        console.log(JSON.stringify({ 
          status: 'error', 
          message: `Project is not ready (status: ${project.status})`,
          hint: 'Wait for the project to become active'
        }));
      } else {
        console.error(`\n${C.error}Error:${C.reset} Project is not ready (status: ${C.value}${project.status}${C.reset})`);
        console.error(`  Wait for the project to become active\n`);
      }
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: `Failed to check project status: ${error instanceof Error ? error.message : String(error)}` }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} Failed to check project status`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
    return;
  }
  let connectionString: string | undefined;
  
  try {
    const poolerConfig = await client.getPoolerConfig(projectRef);
    const sessionPooler = poolerConfig.find(p => p.pool_mode === 'session' && p.database_type === 'PRIMARY');
    const fallbackPooler = poolerConfig.find(p => p.database_type === 'PRIMARY');
    const pooler = sessionPooler || fallbackPooler;
    
    if (pooler?.connection_string) {
      connectionString = pooler.connection_string
        .replace('[YOUR-PASSWORD]', dbPassword)
        .replace(':6543/', ':5432/');
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'Failed to get connection string' }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} Failed to get database connection`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (!connectionString) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', message: 'No connection string available' }));
    } else {
      console.error(`\n${C.error}Error:${C.reset} No database connection available`);
    }
    process.exitCode = 1;
    return;
  }

  // Config file path
  const configPath = join(cwd, 'supabase', 'config.json');

  // Get seed configuration
  const seedConfig = getSeedConfig(config, options);
  const seedEnabled = seedConfig.enabled;
  const seedPaths = seedConfig.paths;
  const supabaseDir = join(cwd, 'supabase');
  const seedDir = join(supabaseDir, 'seeds');

  // State
  const state: DevState = {
    profile,
    projectRef,
    connectionString,
    pendingSchemaChanges: new Set(),
    pendingConfigChange: false,
    pendingSeedChange: false,
    lastPush: 0,
    isApplying: false,
    seedApplied: false,
  };

  // JSON mode - output events as NDJSON
  if (options.json) {
    console.log(JSON.stringify({
      status: 'running',
      profile: profile?.name,
      projectRef,
      branch: currentBranch,
      schemaDir: relative(cwd, schemaDir),
      seedEnabled,
      seedPaths: seedEnabled ? seedPaths : undefined,
    }));

    let lastBranch = currentBranch;
    let debounceTimer: NodeJS.Timeout | null = null;

    // Branch watcher
    const branchCheck = setInterval(() => {
      const newBranch = getCurrentBranch(cwd);
      if (newBranch && newBranch !== lastBranch) {
        lastBranch = newBranch;
        const matched = getProfileForBranch(config, newBranch);
        console.log(JSON.stringify({
          event: matched ? 'profile_changed' : 'branch_changed',
          branch: newBranch,
          profile: matched?.name,
        }));
        
        if (matched) {
          state.profile = matched;
          state.projectRef = getProjectRef(config, matched);
        }
      }
    }, 5000);

    // File watcher (schema + config)
    const watcher = chokidarWatch([schemaDir, configPath], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher.on('all', async (event, filePath) => {
      const isConfig = basename(filePath) === 'config.json';
      const isSchema = filePath.endsWith('.sql');
      
      if (!isConfig && !isSchema) return;
      
      if (isConfig) {
        console.log(JSON.stringify({ event: 'config_changed', type: event }));
        state.pendingConfigChange = true;
      } else {
        const relPath = relative(schemaDir, filePath);
        console.log(JSON.stringify({ event: 'file_changed', type: event, path: relPath }));
        state.pendingSchemaChanges.add(relPath);
      }
      
      // Debounce
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (state.isApplying || (state.pendingSchemaChanges.size === 0 && !state.pendingConfigChange)) return;
        
        state.isApplying = true;
        const schemaChanges = [...state.pendingSchemaChanges];
        const configChanged = state.pendingConfigChange;
        state.pendingSchemaChanges.clear();
        state.pendingConfigChange = false;
        
        // Apply config changes
        if (configChanged) {
          console.log(JSON.stringify({ event: 'config_sync_start' }));
          try {
            const freshConfig = loadProjectConfig(cwd) as ProjectConfig;
            if (freshConfig) {
              let appliedCount = 0;
              
              const postgrestPayload = buildPostgrestPayload(freshConfig);
              if (postgrestPayload && Object.keys(postgrestPayload).length > 0) {
                if (options.dryRun) {
                  const remoteConfig = await client.getPostgrestConfig(state.projectRef!);
                  const diffs = compareConfigs(
                    postgrestPayload as Record<string, unknown>,
                    remoteConfig as Record<string, unknown>
                  );
                  console.log(JSON.stringify({ 
                    event: 'config_diff', 
                    type: 'api',
                    changes: diffs.filter(d => d.changed) 
                  }));
                } else {
                  await client.updatePostgrestConfig(state.projectRef!, postgrestPayload);
                  appliedCount++;
                }
              }
              
              const authPayload = buildAuthPayload(freshConfig);
              if (authPayload && Object.keys(authPayload).length > 0) {
                if (options.dryRun) {
                  const remoteConfig = await client.getAuthConfig(state.projectRef!);
                  const diffs = compareConfigs(
                    authPayload as Record<string, unknown>,
                    remoteConfig as Record<string, unknown>
                  );
                  console.log(JSON.stringify({ 
                    event: 'config_diff', 
                    type: 'auth',
                    changes: diffs.filter(d => d.changed) 
                  }));
                } else {
                  await client.updateAuthConfig(state.projectRef!, authPayload);
                  appliedCount++;
                }
              }
              
              console.log(JSON.stringify({ 
                event: 'config_sync_complete',
                dryRun: options.dryRun ?? false,
                applied: appliedCount
              }));
            }
          } catch (error) {
            console.log(JSON.stringify({
              event: 'config_sync_error',
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
        
        // Apply schema changes
        if (schemaChanges.length > 0) {
          console.log(JSON.stringify({ event: 'sync_start', files: schemaChanges }));
          
          try {
            if (options.dryRun) {
              const diff = await diffSchemaWithPgDelta(state.connectionString!, schemaDir);
              console.log(JSON.stringify({
                event: 'sync_plan',
                hasChanges: diff.hasChanges,
                statements: diff.statements,
              }));
            } else {
              const result = await applySchemaWithPgDelta(state.connectionString!, schemaDir);
              console.log(JSON.stringify({
                event: result.success ? 'sync_complete' : 'sync_error',
                success: result.success,
                output: result.output,
                statements: result.statements,
              }));
            }
          } catch (error) {
            console.log(JSON.stringify({
              event: 'sync_error',
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
        
        state.isApplying = false;
      }, debounceMs);
    });

    // Types refresh interval
    let lastTypes = '';
    const typesCheck = setInterval(async () => {
      try {
        const resp = await client.getTypescriptTypes(state.projectRef!, 'public');
        if (resp.types !== lastTypes) {
          lastTypes = resp.types;
          const typesPath = join(cwd, 'supabase', 'types', 'database.ts');
          mkdirSync(dirname(typesPath), { recursive: true });
          writeFileSync(typesPath, resp.types);
          console.log(JSON.stringify({ event: 'types_updated', path: relative(cwd, typesPath) }));
        }
      } catch (err) {
        console.log(JSON.stringify({
          event: 'types_error',
          message: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    }, typesIntervalMs);

    // Initial sync - apply any pending schema changes
    console.log(JSON.stringify({ event: 'initial_sync_start' }));
    try {
      if (options.dryRun) {
        const diff = await diffSchemaWithPgDelta(connectionString, schemaDir);
        console.log(JSON.stringify({
          event: 'initial_sync_plan',
          hasChanges: diff.hasChanges,
          statements: diff.statements,
        }));
        // Show seed info in dry-run
        if (seedEnabled) {
          const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
          if (existingSeedFiles.length > 0) {
            console.log(JSON.stringify({
              event: 'seed_plan',
              files: existingSeedFiles.length,
            }));
          }
        }
      } else {
        const result = await applySchemaWithPgDelta(connectionString, schemaDir);
        console.log(JSON.stringify({
          event: result.success ? 'initial_sync_complete' : 'initial_sync_error',
          success: result.success,
          output: result.output,
          statements: result.statements,
        }));
        
        // Apply seed after initial sync (JSON mode)
        if (result.success && seedEnabled) {
          const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
          if (existingSeedFiles.length > 0) {
            console.log(JSON.stringify({ event: 'seed_start', files: existingSeedFiles.length }));
            try {
              const seedResult = await applySeedFiles(connectionString, seedPaths, supabaseDir);
              console.log(JSON.stringify({
                event: seedResult.success ? 'seed_complete' : 'seed_error',
                filesApplied: seedResult.filesApplied,
                totalFiles: seedResult.totalFiles,
                errors: seedResult.errors,
              }));
            } catch (seedError) {
              console.log(JSON.stringify({
                event: 'seed_error',
                error: seedError instanceof Error ? seedError.message : String(seedError),
              }));
            }
          }
        }
      }
    } catch (error) {
      console.log(JSON.stringify({
        event: 'initial_sync_error',
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    // Cleanup
    process.on('SIGINT', async () => {
      clearInterval(branchCheck);
      clearInterval(typesCheck);
      watcher.close();
      await closeSupabasePool();
      console.log(JSON.stringify({ status: 'stopped' }));
      process.exit(0);
    });

    return;
  }

  // Interactive mode - raw ANSI output
  let currentLine = '';
  let spinnerInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let spinnerFrame = 0;
  let heartbeatFrame = 0;
  let lastActivity = Date.now();
  let debounceTimer: NodeJS.Timeout | null = null;

  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  const clearLine = () => {
    if (currentLine) {
      const len = stripAnsi(currentLine).length;
      process.stdout.write(`\r${' '.repeat(len)}\r`);
      currentLine = '';
    }
  };

  const writeLine = (msg: string) => {
    clearLine();
    process.stdout.write(`\r${msg}\x1b[K`);
    currentLine = msg;
  };

  const log = (msg: string) => {
    clearLine();
    console.log(msg);
    lastActivity = Date.now();
    needsBlankBeforeHeartbeat = true; // Reset so we get a blank line before next idle
  };

  const startSpinner = (msg: string) => {
    lastActivity = Date.now();
    stopHeartbeat();
    if (spinnerInterval) clearInterval(spinnerInterval);
    
    spinnerFrame = 0;
    const update = () => {
      const char = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
      writeLine(`${C.icon}${char}${C.reset} ${msg}`);
      spinnerFrame++;
    };
    update();
    spinnerInterval = setInterval(update, 80);
  };

  const stopSpinner = (msg: string, success = true) => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
    const icon = success ? `${C.success}✓${C.reset}` : `${C.error}✗${C.reset}`;
    log(`${icon} ${msg}`);
    startHeartbeat();
  };

  // Track if we need a blank line before the next heartbeat
  let needsBlankBeforeHeartbeat = true;

  const startHeartbeat = () => {
    if (heartbeatInterval) return;
    
    heartbeatInterval = setInterval(() => {
      const idle = Date.now() - lastActivity > 1000;
      if (idle && !spinnerInterval) {
        // Add blank line before heartbeat when transitioning to idle
        if (needsBlankBeforeHeartbeat) {
          console.log('');
          needsBlankBeforeHeartbeat = false;
        }
        const char = HEARTBEAT_FRAMES[heartbeatFrame % HEARTBEAT_FRAMES.length];
        writeLine(`${C.secondary}${char} Watching for changes...${C.reset}`);
        heartbeatFrame++;
      }
    }, 350);
  };

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  // Types tracking - shared between sync and interval
  let lastTypesContent = '';
  let lastTypesRefreshTime = 0;

  // Print header
  console.log('');
  console.log(`${C.bold}supa dev${C.reset} ${C.secondary}— watching for schema and config changes${C.reset}`);
  console.log('');
  console.log(`${C.secondary}Project:${C.reset} ${C.value}${projectRef}${C.reset}`);
  console.log(`${C.secondary}Profile:${C.reset} ${C.value}${profile?.name || 'default'}${C.reset}`);
  console.log(`${C.secondary}Branch:${C.reset}  ${C.fileName}${currentBranch}${C.reset}`);
  console.log(`${C.secondary}Schema:${C.reset}  ${C.fileName}${relative(cwd, schemaDir)}${C.reset}`);
  console.log(`${C.secondary}Config:${C.reset}  ${C.fileName}${relative(cwd, configPath)}${C.reset}`);
  if (seedEnabled) {
    const seedDisplay = seedPaths.length === 1 ? seedPaths[0] : `${seedPaths.length} paths`;
    console.log(`${C.secondary}Seed:${C.reset}    ${C.fileName}${seedDisplay}${C.reset}`);
  }
  console.log(`${C.secondary}Types:${C.reset}   ${C.value}every ${typesIntervalMs / 1000}s${C.reset}`);
  if (options.dryRun) {
    console.log(`${C.warning}Mode:${C.reset}    ${C.warning}dry-run (no changes applied)${C.reset}`);
  }
  console.log('');

  let lastBranch = currentBranch;

  // Branch watcher
  let branchCheck: NodeJS.Timeout | undefined;
  if (!options.noBranchWatch) {
    branchCheck = setInterval(() => {
      const newBranch = getCurrentBranch(cwd);
      if (newBranch && newBranch !== lastBranch) {
        lastBranch = newBranch;
        const matched = getProfileForBranch(config, newBranch);
        
        if (matched && matched.name !== state.profile?.name) {
          state.profile = matched;
          state.projectRef = getProjectRef(config, matched);
          log(`${C.icon}→${C.reset} Branch ${C.fileName}${newBranch}${C.reset} → profile ${C.value}${matched.name}${C.reset}`);
        } else {
          log(`${C.icon}→${C.reset} Branch ${C.fileName}${newBranch}${C.reset}`);
        }
      }
    }, 5000);
  }

  // Apply config changes
  const applyConfigChanges = async () => {
    startSpinner(`${C.secondary}Syncing${C.reset} ${C.fileName}config.json${C.reset}`);
    
    try {
      // Reload config from disk
      const freshConfig = loadProjectConfig(cwd) as ProjectConfig;
      if (!freshConfig) {
        stopSpinner(`${C.error}Failed to reload config${C.reset}`, false);
        return;
      }
      
      let appliedCount = 0;
      
      // Build and apply postgrest config
      const postgrestPayload = buildPostgrestPayload(freshConfig);
      if (postgrestPayload && Object.keys(postgrestPayload).length > 0) {
        if (options.dryRun) {
          const remoteConfig = await client.getPostgrestConfig(state.projectRef!);
          const diffs = compareConfigs(
            postgrestPayload as Record<string, unknown>,
            remoteConfig as Record<string, unknown>
          );
          const changedDiffs = diffs.filter(d => d.changed);
          if (changedDiffs.length > 0) {
            log(`${C.secondary}  API config: ${changedDiffs.length} changes${C.reset}`);
            for (const diff of changedDiffs.slice(0, 3)) {
              log(`${C.secondary}    ${diff.key}: ${String(diff.remote)} → ${String(diff.local)}${C.reset}`);
            }
          }
        } else {
          await client.updatePostgrestConfig(state.projectRef!, postgrestPayload);
          appliedCount++;
        }
      }
      
      // Build and apply auth config
      const authPayload = buildAuthPayload(freshConfig);
      if (authPayload && Object.keys(authPayload).length > 0) {
        if (options.dryRun) {
          const remoteConfig = await client.getAuthConfig(state.projectRef!);
          const diffs = compareConfigs(
            authPayload as Record<string, unknown>,
            remoteConfig as Record<string, unknown>
          );
          const changedDiffs = diffs.filter(d => d.changed);
          if (changedDiffs.length > 0) {
            log(`${C.secondary}  Auth config: ${changedDiffs.length} changes${C.reset}`);
            for (const diff of changedDiffs.slice(0, 3)) {
              log(`${C.secondary}    ${diff.key}: ${String(diff.remote)} → ${String(diff.local)}${C.reset}`);
            }
          }
        } else {
          await client.updateAuthConfig(state.projectRef!, authPayload);
          appliedCount++;
        }
      }
      
      if (options.dryRun) {
        stopSpinner(`${C.secondary}Config diff shown (dry-run)${C.reset}`);
      } else if (appliedCount > 0) {
        stopSpinner(`Config synced`);
      } else {
        stopSpinner(`${C.secondary}No config changes${C.reset}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      stopSpinner(`${C.error}Config sync failed: ${msg}${C.reset}`, false);
    }
  };

  // Apply schema changes
  const applySchemaChanges = async (changedFiles: string[]) => {
    const fileList = changedFiles.slice(0, 3).join(', ');
    const extra = changedFiles.length > 3 ? ` +${changedFiles.length - 3} more` : '';
    
    startSpinner(`${C.secondary}Syncing${C.reset} ${C.fileName}${fileList}${extra}${C.reset}`);

    try {
      if (options.dryRun) {
        // Dry run - just show the diff
        const diff = await diffSchemaWithPgDelta(state.connectionString!, schemaDir);
        
        if (!diff.hasChanges) {
          stopSpinner(`${C.secondary}No schema changes to apply${C.reset}`);
        } else {
          stopSpinner(`${C.secondary}Would apply ${diff.statements.length} statements (dry-run)${C.reset}`);
          for (const stmt of diff.statements.slice(0, 5)) {
            console.log(`  ${C.secondary}${stmt.length > 70 ? stmt.slice(0, 67) + '...' : stmt}${C.reset}`);
          }
          if (diff.statements.length > 5) {
            console.log(`  ${C.secondary}... and ${diff.statements.length - 5} more${C.reset}`);
          }
        }
      } else {
        // Actually apply
        const result = await applySchemaWithPgDelta(state.connectionString!, schemaDir);
        
        if (result.success) {
          if (result.output === 'No changes to apply') {
            stopSpinner(`${C.secondary}No schema changes detected${C.reset}`);
          } else {
            stopSpinner(`Synced ${C.value}${result.statements ?? 0}${C.reset} schema statements`);
            
            // Refresh types after successful schema change
            try {
              const typesResp = await client.getTypescriptTypes(state.projectRef!, 'public');
              const typesPath = join(cwd, 'supabase', 'types', 'database.ts');
              mkdirSync(dirname(typesPath), { recursive: true });
              writeFileSync(typesPath, typesResp.types);
              lastTypesContent = typesResp.types;
              lastTypesRefreshTime = Date.now();
              log(`${C.success}✓${C.reset} ${C.secondary}Types refreshed${C.reset}`);
            } catch {
              // Types refresh failed, not critical
            }
          }
        } else {
          stopSpinner(`${C.error}Schema sync failed: ${result.output}${C.reset}`, false);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      stopSpinner(`${C.error}Error: ${msg}${C.reset}`, false);
    }
  };

  // Apply seed files
  const applySeed = async (reason: 'initial' | 'change' = 'change') => {
    if (!seedEnabled || options.dryRun) return;
    
    // Check if there are any seed files
    const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
    if (existingSeedFiles.length === 0) {
      if (reason === 'initial') {
        log(`${C.secondary}No seed files found${C.reset}`);
      }
      return;
    }
    
    startSpinner(`${C.secondary}Seeding${C.reset} database`);
    
    try {
      const result = await applySeedFiles(state.connectionString!, seedPaths, supabaseDir);
      
      if (result.success) {
        stopSpinner(`Seeded ${C.value}${result.filesApplied}${C.reset} files`);
      } else {
        const errorSummary = result.errors.slice(0, 2).map(e => e.file).join(', ');
        stopSpinner(`${C.warning}Seeded with ${result.errors.length} errors: ${errorSummary}${C.reset}`, false);
      }
      state.seedApplied = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      stopSpinner(`${C.error}Seed failed: ${msg}${C.reset}`, false);
    }
  };

  // Apply pending changes
  const applyPendingChanges = async () => {
    if (state.isApplying) return;
    if (state.pendingSchemaChanges.size === 0 && !state.pendingConfigChange && !state.pendingSeedChange) return;
    
    state.isApplying = true;
    
    const schemaChanges = [...state.pendingSchemaChanges];
    const configChanged = state.pendingConfigChange;
    const seedChanged = state.pendingSeedChange;
    state.pendingSchemaChanges.clear();
    state.pendingConfigChange = false;
    state.pendingSeedChange = false;
    
    // Apply config first
    if (configChanged) {
      await applyConfigChanges();
    }
    
    // Then schema
    if (schemaChanges.length > 0) {
      await applySchemaChanges(schemaChanges);
    }
    
    // Then seeds (only if seed files changed, or after schema changes if --seed flag)
    if (seedChanged || (schemaChanges.length > 0 && options.seed)) {
      await applySeed('change');
    }
    
    state.isApplying = false;
    state.lastPush = Date.now();
  };

  // Build watch paths - schema, config, and optionally seeds
  const watchPaths = [schemaDir, configPath];
  if (seedEnabled && existsSync(seedDir)) {
    watchPaths.push(seedDir);
  }

  // File watcher (schema + config + seeds)
  const watcher = chokidarWatch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('all', (event, filePath) => {
    const isConfig = basename(filePath) === 'config.json';
    const isSchema = filePath.startsWith(schemaDir) && filePath.endsWith('.sql');
    const isSeed = seedEnabled && filePath.startsWith(seedDir) && filePath.endsWith('.sql');
    
    if (!isConfig && !isSchema && !isSeed) return;
    
    // Log the change
    const eventIcon = event === 'add' ? '+' : event === 'unlink' ? '-' : '~';
    const eventColor = event === 'add' ? C.success : event === 'unlink' ? C.error : C.icon;
    
    if (isConfig) {
      log(`${eventColor}${eventIcon}${C.reset} ${C.fileName}config.json${C.reset}`);
      state.pendingConfigChange = true;
    } else if (isSeed) {
      const relPath = relative(seedDir, filePath);
      log(`${eventColor}${eventIcon}${C.reset} ${C.fileName}seeds/${relPath}${C.reset}`);
      state.pendingSeedChange = true;
    } else {
      const relPath = relative(schemaDir, filePath);
      log(`${eventColor}${eventIcon}${C.reset} ${C.fileName}${relPath}${C.reset}`);
      state.pendingSchemaChanges.add(relPath);
    }
    
    // Debounce changes
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      applyPendingChanges();
    }, debounceMs);
  });

  // Types refresh interval
  const typesCheck = setInterval(async () => {
    // Don't refresh during apply or if we just refreshed recently (within 10s)
    if (state.isApplying) return;
    if (Date.now() - lastTypesRefreshTime < 10000) return;
    
    try {
      const resp = await client.getTypescriptTypes(state.projectRef!, 'public');
      if (resp.types !== lastTypesContent) {
        lastTypesContent = resp.types;
        lastTypesRefreshTime = Date.now();
        const typesPath = join(cwd, 'supabase', 'types', 'database.ts');
        mkdirSync(dirname(typesPath), { recursive: true });
        writeFileSync(typesPath, resp.types);
        log(`${C.success}✓${C.reset} ${C.secondary}Types updated${C.reset}`);
      }
    } catch {
      // Silent failure for types refresh
    }
  }, typesIntervalMs);

  // Initial sync - apply any pending schema changes
  startSpinner(`${C.secondary}Checking for pending changes...${C.reset}`);
  try {
    if (options.dryRun) {
      // In dry-run mode, just show what would be applied
      const diff = await diffSchemaWithPgDelta(connectionString, schemaDir);
      if (diff.hasChanges) {
        stopSpinner(`${C.secondary}Would apply ${diff.statements.length} statements (dry-run)${C.reset}`);
        for (const stmt of diff.statements.slice(0, 5)) {
          console.log(`  ${C.secondary}${stmt.length > 70 ? stmt.slice(0, 67) + '...' : stmt}${C.reset}`);
        }
        if (diff.statements.length > 5) {
          console.log(`  ${C.secondary}... and ${diff.statements.length - 5} more${C.reset}`);
        }
      } else {
        stopSpinner(`${C.secondary}Schema is up to date${C.reset}`);
      }
      // Show seed info in dry-run mode
      if (seedEnabled) {
        const existingSeedFiles = findSeedFiles(seedPaths, supabaseDir);
        if (existingSeedFiles.length > 0) {
          log(`${C.secondary}Would apply ${existingSeedFiles.length} seed file(s)${C.reset}`);
        }
      }
    } else {
      // Apply pending changes
      const result = await applySchemaWithPgDelta(connectionString, schemaDir);
      if (result.success) {
        if (result.output === 'No changes to apply') {
          stopSpinner(`${C.secondary}Schema is up to date${C.reset}`);
        } else {
          stopSpinner(`Synced ${C.value}${result.statements ?? 0}${C.reset} pending statements`);
          // Refresh types after initial sync
          try {
            const typesResp = await client.getTypescriptTypes(state.projectRef!, 'public');
            const typesPath = join(cwd, 'supabase', 'types', 'database.ts');
            mkdirSync(dirname(typesPath), { recursive: true });
            writeFileSync(typesPath, typesResp.types);
            lastTypesContent = typesResp.types;
            lastTypesRefreshTime = Date.now();
            log(`${C.success}✓${C.reset} ${C.secondary}Types refreshed${C.reset}`);
          } catch {
            // Types refresh failed, not critical
          }
        }
        
        // Apply initial seed if enabled and not already applied
        if (seedEnabled && !state.seedApplied) {
          await applySeed('initial');
        }
      } else {
        stopSpinner(`${C.error}Initial sync failed: ${result.output}${C.reset}`, false);
      }
    }
  } catch (error) {
    stopSpinner(`${C.warning}Could not sync: ${error instanceof Error ? error.message : String(error)}${C.reset}`, false);
  }

  // Start heartbeat
  startHeartbeat();

  // Graceful shutdown
  const cleanup = async () => {
    stopHeartbeat();
    if (spinnerInterval) clearInterval(spinnerInterval);
    if (branchCheck) clearInterval(branchCheck);
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(typesCheck);
    watcher.close();
    await closeSupabasePool();
    clearLine();
    console.log(`\n${C.secondary}Dev mode stopped${C.reset}\n`);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
