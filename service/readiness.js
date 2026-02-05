/**
 * readiness.js - Issue readiness evaluation for self-iteration
 *
 * Evaluates whether an issue is ready to be worked on based on:
 * - Label constraints (blocking labels, required labels)
 * - Dependencies (blocked by references in body)
 * - Bot comment filtering (for PR feedback sources)
 * - Priority scoring (label weights, age bonus)
 */

import { hasNonBotFeedback } from "./utils.js";

/**
 * Dependency reference patterns in issue body
 */
const DEPENDENCY_PATTERNS = [
  /blocked by #\d+/i,
  /blocked by [a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+#\d+/i,
  /depends on #\d+/i,
  /depends on [a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+#\d+/i,
  /requires #\d+/i,
  /waiting on #\d+/i,
  /waiting for #\d+/i,
  /after #\d+/i,
];

/**
 * Check if issue passes label constraints
 * @param {object} issue - Issue with labels array
 * @param {object} config - Repo config with readiness settings
 * @returns {object} { ready: boolean, reason?: string }
 */
export function checkLabels(issue, config) {
  const labels = issue.labels || [];
  const labelNames = labels.map((l) =>
    typeof l === "string" ? l.toLowerCase() : (l.name || "").toLowerCase()
  );

  const readinessConfig = config.readiness || {};
  const labelConfig = readinessConfig.labels || {};

  // Check exclude labels (blocking)
  const excludeLabels = (labelConfig.exclude || []).map((l) => l.toLowerCase());
  const blockingLabels = (
    readinessConfig.dependencies?.blocking_labels || []
  ).map((l) => l.toLowerCase());

  const allBlocked = [...new Set([...excludeLabels, ...blockingLabels])];

  for (const blockedLabel of allBlocked) {
    if (labelNames.includes(blockedLabel)) {
      return {
        ready: false,
        reason: `Has blocking label: ${blockedLabel}`,
      };
    }
  }

  // Check required labels (must have all)
  const requiredLabels = (labelConfig.required || []).map((l) =>
    l.toLowerCase()
  );
  for (const required of requiredLabels) {
    if (!labelNames.includes(required)) {
      return {
        ready: false,
        reason: `Missing required label: ${required}`,
      };
    }
  }

  // Check any_of labels (must have at least one)
  const anyOfLabels = (labelConfig.any_of || []).map((l) => l.toLowerCase());
  if (anyOfLabels.length > 0) {
    const hasAny = anyOfLabels.some((l) => labelNames.includes(l));
    if (!hasAny) {
      return {
        ready: false,
        reason: `Missing one of required labels: ${anyOfLabels.join(", ")}`,
      };
    }
  }

  return { ready: true };
}

/**
 * Check if issue has dependency references in body
 * @param {object} issue - Issue with body string
 * @param {object} config - Repo config with readiness settings
 * @returns {object} { ready: boolean, reason?: string, dependencies?: string[] }
 */
export function checkDependencies(issue, config) {
  const readinessConfig = config.readiness || {};
  const depConfig = readinessConfig.dependencies || {};

  // Check if body reference checking is enabled
  if (depConfig.check_body_references === false) {
    return { ready: true };
  }

  const body = issue.body || "";
  const bodyLower = body.toLowerCase();
  const foundDependencies = [];

  // Check explicit dependency patterns
  for (const pattern of DEPENDENCY_PATTERNS) {
    const match = bodyLower.match(pattern);
    if (match) {
      foundDependencies.push(match[0]);
    }
  }

  if (foundDependencies.length > 0) {
    return {
      ready: false,
      reason: `Has dependency references: ${foundDependencies.join(", ")}`,
      dependencies: foundDependencies,
    };
  }

  // Check for unchecked task list items (GitHub checkbox syntax)
  const uncheckedTasks = body.match(/^\s*[-*]\s*\[ \]/gm) || [];
  const checkedTasks = body.match(/^\s*[-*]\s*\[x\]/gim) || [];

  // If this looks like a tracking issue with subtasks and has unchecked items
  if (uncheckedTasks.length > 0 && checkedTasks.length + uncheckedTasks.length > 1) {
    return {
      ready: false,
      reason: `Has ${uncheckedTasks.length} unchecked subtasks`,
    };
  }

  return { ready: true };
}

/**
 * Check if item fields match required values
 * 
 * Generic field-based readiness check. Configured via readiness.fields in config.
 * All specified fields must match their required values for the item to be ready.
 * 
 * Example config:
 *   readiness:
 *     fields:
 *       has_notes: true
 *       type: "meeting"
 * 
 * @param {object} item - Item with fields to check
 * @param {object} config - Config with optional readiness.fields
 * @returns {object} { ready: boolean, reason?: string }
 */
export function checkFields(item, config) {
  const readinessConfig = config.readiness || {};
  const fieldsConfig = readinessConfig.fields || {};
  
  // No fields configured - skip check
  if (Object.keys(fieldsConfig).length === 0) {
    return { ready: true };
  }
  
  // Check each required field
  for (const [field, requiredValue] of Object.entries(fieldsConfig)) {
    const actualValue = item[field];
    
    if (actualValue !== requiredValue) {
      return {
        ready: false,
        reason: `Field '${field}' is ${JSON.stringify(actualValue)}, required ${JSON.stringify(requiredValue)}`,
      };
    }
  }
  
  return { ready: true };
}

/**
 * Check if a PR/issue has meaningful (non-bot, non-author) comments
 * 
 * This check is only applied when the item has been enriched with `_comments`
 * (an array of comment objects with user.login and user.type fields).
 * Items without `_comments` are considered ready (check is skipped).
 * 
 * Used to filter PRs from feedback sources where bot comments (CI, coverage, etc.)
 * should not trigger the author to take action.
 * 
 * @param {object} item - Item with optional _comments array and user.login
 * @param {object} config - Repo config (currently unused but kept for API consistency)
 * @returns {object} { ready: boolean, reason?: string }
 */
export function checkBotComments(item, config) {
  // Skip check if no _comments field (item not enriched)
  if (!item._comments) {
    return { ready: true };
  }
  
  // Empty comments array means no comments - consider ready (no feedback)
  if (item._comments.length === 0) {
    return { ready: true };
  }
  
  // Get author username
  const authorUsername = item.user?.login;
  
  // Check if there's non-bot, non-author feedback
  if (hasNonBotFeedback(item._comments, authorUsername)) {
    return { ready: true };
  }
  
  return {
    ready: false,
    reason: "Only bot or author comments - no human feedback requiring action",
  };
}

/**
 * Check if a PR has merge conflicts
 * 
 * This check is only applied when the item has been enriched with `_mergeable`
 * (the mergeable status from GitHub: "MERGEABLE", "CONFLICTING", or "UNKNOWN").
 * Items without `_mergeable` are considered ready (check is skipped).
 * 
 * Used by the my-prs-conflicts source to filter to only PRs with conflicts.
 * 
 * @param {object} item - Item with optional _mergeable field
 * @param {object} config - Repo config with optional readiness.require_conflicts
 * @returns {object} { ready: boolean, reason?: string }
 */
export function checkMergeable(item, config) {
  const readinessConfig = config.readiness || {};
  
  // Skip check if no _mergeable field (item not enriched)
  if (!item._mergeable) {
    return { ready: true };
  }
  
  // Check if we require conflicts (for conflict-detection sources)
  if (readinessConfig.require_conflicts) {
    if (item._mergeable === "CONFLICTING") {
      return { ready: true };
    }
    return {
      ready: false,
      reason: `PR is ${item._mergeable}, not CONFLICTING`,
    };
  }
  
  // Default: allow any mergeable status
  return { ready: true };
}

/**
 * Check if a PR needs attention (has conflicts OR human feedback)
 * 
 * This check uses the _has_attention field computed by computeAttentionLabels().
 * Items without _has_attention are considered ready (check is skipped).
 * 
 * Used by the my-prs-attention source to filter to PRs needing action.
 * 
 * @param {object} item - Item with optional _has_attention field
 * @param {object} config - Repo config with optional readiness.require_attention
 * @returns {object} { ready: boolean, reason?: string }
 */
export function checkAttention(item, config) {
  const readinessConfig = config.readiness || {};
  
  // Skip check if require_attention not configured
  if (!readinessConfig.require_attention) {
    return { ready: true };
  }
  
  // Skip check if _has_attention not computed (item not enriched)
  if (item._has_attention === undefined) {
    return { ready: true };
  }
  
  if (item._has_attention) {
    return { ready: true };
  }
  
  return {
    ready: false,
    reason: "PR has no conflicts and no human feedback - no attention needed",
  };
}

/**
 * Calculate priority score for an issue
 * @param {object} issue - Issue with labels and created_at
 * @param {object} config - Repo config with readiness settings
 * @returns {number} Priority score (higher = more urgent)
 */
export function calculatePriority(issue, config) {
  const readinessConfig = config.readiness || {};
  const priorityConfig = readinessConfig.priority || {};

  let score = 0;

  // Label-based priority
  const labels = issue.labels || [];
  const labelNames = labels.map((l) =>
    typeof l === "string" ? l.toLowerCase() : (l.name || "").toLowerCase()
  );

  const labelWeights = priorityConfig.labels || [];
  for (const { label, weight } of labelWeights) {
    if (labelNames.includes(label.toLowerCase())) {
      score += weight || 0;
    }
  }

  // Age-based priority (older issues get higher priority)
  const ageWeight = priorityConfig.age_weight || 0;
  if (ageWeight > 0 && issue.created_at) {
    const createdAt = new Date(issue.created_at);
    const ageInDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    score += ageInDays * ageWeight;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Evaluate overall readiness of an issue
 * @param {object} issue - Issue object
 * @param {object} config - Repo config with readiness settings
 * @returns {object} { ready: boolean, reason?: string, priority: number }
 */
export function evaluateReadiness(issue, config) {
  // Check labels first
  const labelResult = checkLabels(issue, config);
  if (!labelResult.ready) {
    return {
      ready: false,
      reason: labelResult.reason,
      priority: 0,
    };
  }

  // Check dependencies
  const depResult = checkDependencies(issue, config);
  if (!depResult.ready) {
    return {
      ready: false,
      reason: depResult.reason,
      priority: 0,
    };
  }

  // Check bot comments (for PRs enriched with _comments)
  // Skip this check when require_attention is set, because checkAttention
  // handles the combined logic (conflicts OR feedback) via _has_attention
  const readinessConfig = config.readiness || {};
  if (!readinessConfig.require_attention) {
    const botResult = checkBotComments(issue, config);
    if (!botResult.ready) {
      return {
        ready: false,
        reason: botResult.reason,
        priority: 0,
      };
    }
  }

  // Check mergeable status (for PRs enriched with _mergeable)
  const mergeableResult = checkMergeable(issue, config);
  if (!mergeableResult.ready) {
    return {
      ready: false,
      reason: mergeableResult.reason,
      priority: 0,
    };
  }

  // Check attention status (for PRs needing conflicts OR feedback)
  const attentionResult = checkAttention(issue, config);
  if (!attentionResult.ready) {
    return {
      ready: false,
      reason: attentionResult.reason,
      priority: 0,
    };
  }

  // Check required field values
  const fieldsResult = checkFields(issue, config);
  if (!fieldsResult.ready) {
    return {
      ready: false,
      reason: fieldsResult.reason,
      priority: 0,
    };
  }

  // Calculate priority for ready issues
  const priority = calculatePriority(issue, config);

  return {
    ready: true,
    priority,
  };
}

/**
 * Sort issues by priority (highest first)
 * @param {Array} issues - Array of issues
 * @param {object} config - Repo config
 * @returns {Array} Sorted issues with priority scores
 */
export function sortByPriority(issues, config) {
  return issues
    .map((issue) => ({
      ...issue,
      _priority: calculatePriority(issue, config),
    }))
    .sort((a, b) => b._priority - a._priority);
}

/**
 * Filter issues to only ready ones
 * @param {Array} issues - Array of issues
 * @param {object} config - Repo config
 * @returns {Array} Ready issues with evaluation results
 */
export function filterReady(issues, config) {
  return issues
    .map((issue) => ({
      ...issue,
      _readiness: evaluateReadiness(issue, config),
    }))
    .filter((issue) => issue._readiness.ready);
}
