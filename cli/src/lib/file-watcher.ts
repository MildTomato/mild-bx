/**
 * Composable file watcher built on chokidar.
 *
 * Register watch sources with a path, optional filter, and a callback.
 * All sources share a single chokidar instance. Changes are debounced.
 */

import { watch as chokidarWatch, type FSWatcher } from "chokidar";

export interface WatchSource {
  /** Directory or file to watch. */
  path: string;
  /** Only fire for files matching this filter. If omitted, all files match. */
  filter?: (filePath: string) => boolean;
  /** Called when a matching file changes. */
  onChange: (event: string, filePath: string) => void;
}

export interface FileWatcherOptions {
  /** Debounce interval in ms. Default 500. */
  debounceMs?: number;
  /** Called when the watcher is ready. */
  onReady?: (watched: Record<string, string[]>) => void;
}

export interface FileWatcher {
  /** The underlying chokidar instance. */
  watcher: FSWatcher;
  /** Close the watcher. */
  close: () => Promise<void>;
}

/**
 * Create a file watcher from a list of watch sources.
 * Each source gets its own path + filter + callback.
 * A single chokidar instance watches all paths.
 */
export function createFileWatcher(
  sources: WatchSource[],
  options: FileWatcherOptions = {},
): FileWatcher {
  const paths = sources.map((s) => s.path);

  const watcher = chokidarWatch(paths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  if (options.onReady) {
    watcher.on("ready", () => {
      options.onReady!(watcher.getWatched());
    });
  }

  watcher.on("all", (event, filePath) => {
    for (const source of sources) {
      // Check if this file belongs to this source's watched path
      if (!filePath.startsWith(source.path) && source.path !== filePath) continue;
      // Apply filter if present
      if (source.filter && !source.filter(filePath)) continue;
      source.onChange(event, filePath);
      return; // First match wins
    }
  });

  return {
    watcher,
    close: () => watcher.close(),
  };
}
