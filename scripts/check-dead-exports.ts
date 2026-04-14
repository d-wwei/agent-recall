#!/usr/bin/env bun
/**
 * Dead Export Checker — Service Class Edition
 *
 * Scans all .ts files under src/services/ for `export class` declarations,
 * then checks if each class is referenced (imported or dynamically loaded)
 * anywhere in src/ or tests/. Classes with zero references are reported
 * as orphaned. Exits non-zero if any are found.
 *
 * Why classes only: Functions are often re-exported via barrel files or
 * used as helpers within the same module tree. Service classes (XxxService,
 * XxxRoutes, XxxManager) are the unit of wiring — if one is never imported,
 * it means a feature was implemented but never connected.
 *
 * Usage:
 *   bun scripts/check-dead-exports.ts
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dir, '..');
const SERVICES_DIR = join(ROOT, 'src', 'services');
const SEARCH_DIRS = [join(ROOT, 'src'), join(ROOT, 'tests')];

// Classes that are intentionally not imported within the project:
// - Entry points consumed by esbuild/build system
// - Base classes only extended (detected separately)
// - Deprecated classes kept for backward compat
const ALLOWLIST = new Set([
  'WorkerService',        // Entry point for esbuild bundle
  'ClaudeMemDatabase',    // Legacy name, aliased via SessionStore
  'BaseRouteHandler',     // Abstract base — only extended, never instantiated directly
  'MemoryLayerService',   // Alternative to ObservationCompiler's inline global-scope queries; kept for future refactor
]);

interface ClassInfo {
  name: string;
  file: string;
  line: number;
}

function walkDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractExportedClasses(filePath: string): ClassInfo[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const classes: ClassInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (match) {
      classes.push({ name: match[1], file: filePath, line: i + 1 });
    }
  }
  return classes;
}

function isReferencedElsewhere(className: string, sourceFile: string, allFiles: string[]): boolean {
  // Match import statements, dynamic imports, and string references to the class name
  const pattern = new RegExp(`\\b${className}\\b`);

  for (const file of allFiles) {
    if (file === sourceFile) continue;
    const content = readFileSync(file, 'utf8');
    if (pattern.test(content)) {
      return true;
    }
  }
  return false;
}

// --- Main ---

console.log('Dead Export Checker (Service Classes)');
console.log('====================================\n');

// Collect service files to scan for exports
const serviceFiles = walkDir(SERVICES_DIR);
console.log(`Scanning ${serviceFiles.length} service files for exported classes`);

// Collect all files to search for references
const allFiles: string[] = [];
for (const dir of SEARCH_DIRS) {
  allFiles.push(...walkDir(dir));
}
console.log(`Searching ${allFiles.length} files for references\n`);

// Extract exported classes
const allClasses: ClassInfo[] = [];
for (const file of serviceFiles) {
  allClasses.push(...extractExportedClasses(file));
}

console.log(`Found ${allClasses.length} exported classes\n`);

// Check each class
const orphaned: ClassInfo[] = [];
for (const cls of allClasses) {
  if (ALLOWLIST.has(cls.name)) continue;
  if (!isReferencedElsewhere(cls.name, cls.file, allFiles)) {
    orphaned.push(cls);
  }
}

// Report
if (orphaned.length === 0) {
  console.log('All exported service classes are referenced. No dead code found.');
  process.exit(0);
} else {
  console.log(`Found ${orphaned.length} orphaned service class(es):\n`);
  for (const cls of orphaned) {
    const relPath = relative(ROOT, cls.file);
    console.log(`  class ${cls.name}`);
    console.log(`    ${relPath}:${cls.line}\n`);
  }
  console.log('These classes are exported but never imported or referenced.');
  console.log('Either wire them into the system, add to ALLOWLIST, or remove them.\n');
  console.log('To add to allowlist: edit scripts/check-dead-exports.ts ALLOWLIST set.');
  process.exit(1);
}
