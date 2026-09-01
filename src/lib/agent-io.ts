import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Local output directory each run-agent leg writes into before actions/upload-artifact runs. */
export const AGENT_OUTPUT_DIR = "swarm-reviewer-out";
export const FINDING_FILENAME = "finding.json";
export const AGENT_RESULT_FILENAME = "agent-result.json";

/** Artifact name prefixes — aggregate downloads everything matching `${prefix}*` (research.md #2). */
export const FINDING_ARTIFACT_PREFIX = "finding-";
export const AGENT_RESULT_ARTIFACT_PREFIX = "agent-result-";
export const REPORT_ARTIFACT_NAME = "unified-report";
export const REPORT_FILENAME = "unified-report.json";

export async function writeJsonFile(dir: string, filename: string, data: unknown): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  return path;
}

/**
 * Recursively reads every file named `filename` under `rootDir` and JSON-parses it.
 * Each matching artifact from actions/download-artifact lands in its own subdirectory
 * (no merge-multiple — see aggregate/action.yml), so this walks the whole tree rather
 * than reading one fixed path.
 */
export async function readAllJsonFiles<T>(rootDir: string, filename: string): Promise<T[]> {
  const results: T[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory may not exist if no artifacts matched
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === filename) {
        const content = await readFile(path, "utf-8");
        results.push(JSON.parse(content) as T);
      }
    }
  }

  await walk(rootDir);
  return results;
}
