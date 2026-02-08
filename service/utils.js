/**
 * utils.js - Shared utility functions
 *
 * Common helpers used across service modules.
 */

/**
 * Get a nested field value from an object using dot notation
 * @param {object} obj - Object to traverse
 * @param {string} path - Dot-separated path (e.g., "repository.full_name")
 * @returns {*} Value at path, or undefined if not found
 */
export function getNestedValue(obj, path) {
  const parts = path.split(".");
  let value = obj;
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }
  return value;
}

/**
 * Check if a comment/review is an approval-only (no actionable feedback)
 * 
 * PR reviews have a state field (APPROVED, CHANGES_REQUESTED, COMMENTED).
 * An approval without substantive body text doesn't require action from the author.
 * 
 * @param {object} comment - Comment or review object with optional state and body
 * @returns {boolean} True if this is a pure approval with no actionable feedback
 */
export function isApprovalOnly(comment) {
  // Only applies to PR reviews with APPROVED state
  if (comment.state !== 'APPROVED') return false;
  
  // If there's substantive body text, it might contain feedback
  const body = comment.body || '';
  if (body.trim().length > 0) return false;
  
  return true;
}

/**
 * Check if a username represents a bot account
 * 
 * Detects bots by:
 * 1. Username suffix: [bot] (e.g., "github-actions[bot]", "dependabot[bot]")
 * 2. User type field: "Bot" (GitHub API provides this)
 * 
 * @param {string} username - GitHub username to check
 * @param {string} [type] - User type from API (e.g., "Bot", "User")
 * @returns {boolean} True if the user is a bot
 */
export function isBot(username, type) {
  // Handle null/undefined/empty
  if (!username) return false;
  
  // Check user type field (GitHub API provides "Bot" type)
  if (type && type.toLowerCase() === "bot") return true;
  
  // Check for [bot] suffix in username
  if (username.toLowerCase().endsWith("[bot]")) return true;
  
  // Known bot usernames without [bot] suffix
  // Note: 'Copilot' is intentionally NOT included - Copilot review feedback is actionable
  const knownBots = ['linear'];
  if (knownBots.includes(username.toLowerCase())) return true;
  
  return false;
}

/**
 * Check if feedback is a PR review (has state field from /pulls/{number}/reviews)
 * 
 * PR reviews have a state field: APPROVED, CHANGES_REQUESTED, COMMENTED, PENDING, DISMISSED
 * Regular comments (from /issues/{number}/comments or /pulls/{number}/comments) don't have state.
 * 
 * @param {object} feedback - Comment or review object
 * @returns {boolean} True if this is a PR review (not a regular comment)
 */
export function isPrReview(feedback) {
  return feedback && typeof feedback.state === 'string';
}

/**
 * Check if feedback is an inline PR comment (from /pulls/{number}/comments)
 * 
 * Inline comments have path, position, or diff_hunk fields that top-level comments don't have.
 * They may also have in_reply_to_id if they're replies to other inline comments.
 * 
 * @param {object} feedback - Comment or review object
 * @returns {boolean} True if this is an inline PR comment
 */
export function isInlineComment(feedback) {
  if (!feedback) return false;
  // Inline comments have path (file path) and usually diff_hunk or position
  return typeof feedback.path === 'string' || typeof feedback.diff_hunk === 'string';
}

/**
 * Check if feedback is a reply to another comment
 * 
 * @param {object} feedback - Comment or review object
 * @returns {boolean} True if this is a reply
 */
export function isReply(feedback) {
  if (!feedback) return false;
  // PR review comments use in_reply_to_id for replies
  return feedback.in_reply_to_id !== undefined && feedback.in_reply_to_id !== null;
}

/**
 * Extract issue references from text (PR title, body, etc.)
 * 
 * Used for cross-source deduplication: when a PR references an issue,
 * both should be treated as the same work item.
 * 
 * Supported patterns:
 * - Linear issues: ENG-123, PROJ-456 (uppercase prefix, hyphen, numbers)
 * - GitHub issues: #123, org/repo#123, Fixes #123, Closes org/repo#456
 * 
 * @param {string} text - Text to extract references from
 * @param {object} [context] - Optional context for resolving relative refs
 * @param {string} [context.repo] - Repository (e.g., "org/repo") for resolving #123
 * @returns {string[]} Array of normalized issue references (e.g., ["linear:ENG-123", "github:org/repo#123"])
 */
export function extractIssueRefs(text, context = {}) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  const refs = new Set();
  
  // Linear issue pattern: ENG-123, PROJ-456 (1-10 char uppercase prefix)
  // Must be word-bounded to avoid matching random strings
  const linearPattern = /\b([A-Z][A-Z0-9]{0,9}-\d+)\b/g;
  let match;
  while ((match = linearPattern.exec(text)) !== null) {
    refs.add(`linear:${match[1]}`);
  }
  
  // GitHub issue patterns:
  // - Full: org/repo#123
  // - Relative: #123 (needs context.repo)
  // - Keywords: Fixes #123, Closes org/repo#456, Resolves #789
  
  // Full repo reference: org/repo#123
  const fullGithubPattern = /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)#(\d+)\b/g;
  while ((match = fullGithubPattern.exec(text)) !== null) {
    refs.add(`github:${match[1]}#${match[2]}`);
  }
  
  // Relative reference: #123 (only if context.repo is provided)
  if (context.repo) {
    // Match #123 but not org/repo#123 (already handled above)
    // Use negative lookbehind to avoid matching the # in full refs
    const relativePattern = /(?<![a-zA-Z0-9_.-]\/[a-zA-Z0-9_.-]+)#(\d+)\b/g;
    while ((match = relativePattern.exec(text)) !== null) {
      refs.add(`github:${context.repo}#${match[1]}`);
    }
  }
  
  return Array.from(refs);
}

/**
 * Check if a PR/issue has actionable feedback
 * 
 * Used to filter out PRs where only bots have commented, since those don't
 * require the author's attention.
 * 
 * Logic for author's own feedback:
 * - Author's inline comments (standalone) → trigger (self-review on code)
 * - Author's inline comments (replies) → ignore (responding to reviewer)
 * - Author's PR reviews → trigger (formal self-review)
 * - Author's top-level comments → ignore (conversation noise)
 * 
 * Logic for others' feedback:
 * - Bot comments → ignore
 * - Human comments/reviews → trigger (except approval-only with no body)
 * 
 * @param {Array} comments - Array of comment/review objects with user.login and user.type
 * @param {string} authorUsername - Username of the PR/issue author
 * @returns {boolean} True if there's at least one actionable feedback item
 */
export function hasNonBotFeedback(comments, authorUsername) {
  // Handle null/undefined/empty
  if (!comments || !Array.isArray(comments) || comments.length === 0) {
    return false;
  }
  
  const authorLower = authorUsername?.toLowerCase();
  
  for (const comment of comments) {
    const user = comment.user;
    if (!user) continue;
    
    const username = user.login;
    const userType = user.type;
    
    // Skip if it's a bot (but Copilot is NOT in bot list, so Copilot reviews are kept)
    if (isBot(username, userType)) continue;
    
    // For author's own feedback, apply special rules
    if (authorLower && username?.toLowerCase() === authorLower) {
      // Author's PR reviews → trigger
      if (isPrReview(comment)) {
        // Continue to check if it's actionable (not approval-only)
      }
      // Author's inline comments (standalone only) → trigger
      else if (isInlineComment(comment)) {
        if (isReply(comment)) continue; // Skip replies
        // Standalone inline comment - continue to actionable check
      }
      // Author's top-level comments → ignore
      else {
        continue;
      }
    }
    
    // Skip approval-only reviews (no actionable feedback)
    if (isApprovalOnly(comment)) continue;
    
    // Found actionable feedback
    return true;
  }
  
  return false;
}
