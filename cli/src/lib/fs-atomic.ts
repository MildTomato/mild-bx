/**
 * Atomic file operations
 * Prevents corruption if process crashes during write
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Write file atomically using write-to-temp-then-rename pattern
 * On POSIX systems, rename is atomic and won't leave partial data
 */
export function writeFileAtomic(
  filePath: string,
  content: string,
  options?: { encoding?: BufferEncoding; mode?: number }
): void {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  const encoding = options?.encoding || "utf-8";

  try {
    // Write to temporary file
    fs.writeFileSync(tmpPath, content, { encoding, mode: options?.mode });

    // Atomic rename (on POSIX systems)
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Write JSON file atomically with consistent formatting
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + "\n";
  writeFileAtomic(filePath, content);
}
