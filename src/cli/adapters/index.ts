import type { PlatformAdapter } from '../types.js';
import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { geminiCliAdapter } from './gemini-cli.js';
import { opencodeAdapter } from './opencode.js';
import { rawAdapter } from './raw.js';

export function getPlatformAdapter(platform: string): PlatformAdapter {
  switch (platform) {
    case 'claude-code': return claudeCodeAdapter;
    case 'codex': return codexAdapter;
    case 'cursor': return cursorAdapter;
    case 'gemini':
    case 'gemini-cli': return geminiCliAdapter;
    case 'opencode': return opencodeAdapter;
    case 'raw': return rawAdapter;
    default: return rawAdapter;
  }
}

export { claudeCodeAdapter, codexAdapter, cursorAdapter, geminiCliAdapter, opencodeAdapter, rawAdapter };
