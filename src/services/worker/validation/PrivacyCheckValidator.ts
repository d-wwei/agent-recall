import { SessionStore } from '../../sqlite/SessionStore.js';
import { logger } from '../../../utils/logger.js';

/**
 * Validates user prompt privacy for session operations
 *
 * Centralizes privacy checks to avoid duplicate validation logic across route handlers.
 * If user prompt was entirely private (stripped to empty string), we skip processing.
 */
export class PrivacyCheckValidator {
  /**
   * Check if user prompt is public (not entirely private)
   *
   * @param store - SessionStore instance
   * @param contentSessionId - Claude session ID
   * @param promptNumber - Prompt number within session
   * @param operationType - Type of operation being validated ('observation' or 'summarize')
   * @returns User prompt text if public, null if private
   */
  static checkUserPromptPrivacy(
    store: SessionStore,
    contentSessionId: string,
    promptNumber: number,
    operationType: 'observation' | 'summarize',
    sessionDbId: number,
    additionalContext?: Record<string, any>
  ): string | null {
    const userPrompt = store.getUserPrompt(contentSessionId, promptNumber);

    // No prompt found — this happens when PostToolUse fires before UserPromptSubmit
    // records the prompt (race condition), or when hooks aren't fully configured.
    // Treat as public (allow processing) rather than private (skip).
    if (userPrompt === undefined || userPrompt === null) {
      logger.debug('HOOK', `No user prompt found for ${operationType}, proceeding anyway (not private)`, {
        sessionId: sessionDbId,
        promptNumber,
        ...additionalContext
      });
      return '[prompt not yet recorded]';
    }

    // Prompt exists but is empty after privacy tag stripping — actually private
    if (userPrompt.trim() === '') {
      logger.debug('HOOK', `Skipping ${operationType} - user prompt was entirely private`, {
        sessionId: sessionDbId,
        promptNumber,
        ...additionalContext
      });
      return null;
    }

    return userPrompt;
  }
}
