import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';

/**
 * Register hooks by copying source hooks file to target path,
 * substituting $AGENT_RECALL_ROOT with the actual install root.
 *
 * Mirrors what the shell scripts do:
 *   sed "s|\$AGENT_RECALL_ROOT|$AGENT_RECALL_ROOT|g" "$HOOKS_SRC" > "$TARGET"
 */
export function registerHooks(
  agentRecallRoot: string,
  sourcePath: string,
  targetPath: string
): void {
  if (!existsSync(sourcePath)) {
    throw new Error(`Hook source file not found: ${sourcePath}`);
  }

  const content = readFileSync(sourcePath, 'utf-8');
  const substituted = content.replaceAll('$AGENT_RECALL_ROOT', agentRecallRoot);

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, substituted);
}

export function isHooksRegistered(targetPath: string): boolean {
  return existsSync(targetPath);
}

export function removeHooks(targetPath: string): void {
  if (existsSync(targetPath)) {
    unlinkSync(targetPath);
  }
}
