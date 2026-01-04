/**
 * readiness.js - Issue readiness evaluation for self-iteration
 *
 * Evaluates whether an issue is ready to be worked on based on:
 * - Label constraints (blocking labels, required labels)
 * - Dependencies (blocked by references in body)
 * - Priority scoring (label weights, age bonus)
 */

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
