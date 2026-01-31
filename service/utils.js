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
 * Check if a PR/issue has non-bot feedback (comments from humans other than the author)
 * 
 * Used to filter out PRs where only bots have commented, since those don't
 * require the author's attention for human feedback.
 * 
 * Also skips approval-only reviews (APPROVED state with no body text) since
 * approvals don't require action from the author.
 * 
 * @param {Array} comments - Array of comment objects with user.login and user.type
 * @param {string} authorUsername - Username of the PR/issue author
 * @returns {boolean} True if there's at least one non-bot, non-author, actionable comment
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
    
    // Skip if it's a bot
    if (isBot(username, userType)) continue;
    
    // Skip if it's the author themselves
    if (authorLower && username?.toLowerCase() === authorLower) continue;
    
    // Skip approval-only reviews (no actionable feedback)
    if (isApprovalOnly(comment)) continue;
    
    // Found a non-bot, non-author, actionable comment
    return true;
  }
  
  return false;
}
