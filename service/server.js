// Standalone callback server for opencode-ntfy
// Implements Issue #13: Separate callback server as brew service
//
// This service runs persistently via brew services and handles:
// - HTTP callbacks from ntfy action buttons
// - Unix socket IPC for plugin communication
// - Nonce management for permission requests
// - Session registration and response forwarding

import { createServer as createHttpServer } from 'http'
import { createServer as createNetServer } from 'net'
import { randomUUID } from 'crypto'
import { existsSync, unlinkSync, realpathSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { join } from 'path'

// Default configuration
const DEFAULT_HTTP_PORT = 4097
const DEFAULT_SOCKET_PATH = '/tmp/opencode-ntfy.sock'
const CONFIG_PATH = join(homedir(), '.config', 'opencode-ntfy', 'config.json')

/**
 * Load callback config from config file
 * @returns {Object} Config with callbackHttps and callbackHost
 */
function loadCallbackConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf8')
      const config = JSON.parse(content)
      return {
        callbackHttps: config.callbackHttps === true,
        callbackHost: config.callbackHost || null,
      }
    }
  } catch {
    // Ignore errors
  }
  return { callbackHttps: false, callbackHost: null }
}

// Nonce storage: nonce -> { sessionId, permissionId, createdAt }
const nonces = new Map()
const NONCE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Session storage: sessionId -> socket connection
const sessions = new Map()

// Valid response types
const VALID_RESPONSES = ['once', 'always', 'reject']

// Allowed OpenCode port range (OpenCode uses ports like 7596, 7829, etc.)
const MIN_OPENCODE_PORT = 1024
const MAX_OPENCODE_PORT = 65535

// Maximum request body size (1MB)
const MAX_BODY_SIZE = 1024 * 1024

/**
 * Generate a simple HTML response page
 * @param {string} title - Page title
 * @param {string} message - Message to display
 * @param {boolean} success - Whether the operation succeeded
 * @returns {string} HTML content
 */
function htmlResponse(title, message, success) {
  const color = success ? '#22c55e' : '#ef4444'
  const icon = success ? '✓' : '✗'
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - opencode-ntfy</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #1a1a1a; color: #fff; }
    .container { text-align: center; padding: 2rem; }
    .icon { font-size: 4rem; color: ${color}; }
    .message { font-size: 1.5rem; margin-top: 1rem; }
    .hint { color: #888; margin-top: 1rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <div class="message">${message}</div>
    <div class="hint">You can close this tab</div>
  </div>
</body>
</html>`
}

/**
 * HTML-escape a string for safe embedding in HTML
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Validate port is in allowed range
 * @param {number} port - Port to validate
 * @returns {boolean} True if valid
 */
function isValidPort(port) {
  return Number.isInteger(port) && port >= MIN_OPENCODE_PORT && port <= MAX_OPENCODE_PORT
}

/**
 * Generate the mobile session UI HTML page
 * @param {Object} params - Page parameters
 * @param {string} params.repoName - Repository name
 * @param {string} params.sessionId - Session ID
 * @param {number} params.opencodePort - OpenCode server port
 * @returns {string} HTML content
 */
function mobileSessionPage({ repoName, sessionId, opencodePort }) {
  // Escape values for safe HTML embedding
  const safeRepoName = escapeHtml(repoName)
  const safeSessionId = escapeHtml(sessionId)
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>${safeRepoName} - OpenCode</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: #161b22;
      padding: 12px 16px;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header-icon {
      width: 20px;
      height: 20px;
      background: #238636;
      border-radius: 4px;
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
    }
    .header-status {
      margin-left: auto;
      font-size: 12px;
      color: #7d8590;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 16px;
      overflow: hidden;
    }
    .message-container {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 16px;
    }
    .message {
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
    }
    .message-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 13px;
      color: #7d8590;
    }
    .message-role {
      background: #238636;
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .message-content {
      font-size: 15px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message-loading {
      text-align: center;
      color: #7d8590;
      padding: 40px;
    }
    .message-error {
      background: #3d1e20;
      border-color: #f85149;
      color: #f85149;
    }
    .input-container {
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px;
    }
    .input-wrapper {
      display: flex;
      gap: 8px;
    }
    textarea {
      flex: 1;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-family: inherit;
      font-size: 15px;
      padding: 10px 12px;
      resize: none;
      min-height: 44px;
      max-height: 120px;
    }
    textarea:focus {
      outline: none;
      border-color: #238636;
    }
    textarea::placeholder {
      color: #7d8590;
    }
    button {
      background: #238636;
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 20px;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: #2ea043;
    }
    button:disabled {
      background: #21262d;
      color: #7d8590;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-icon"></div>
    <div class="header-title">${safeRepoName}</div>
    <div class="header-status" id="status">Loading...</div>
  </div>
  
  <div class="main">
    <div class="message-container">
      <div class="message" id="message">
        <div class="message-loading">Loading session...</div>
      </div>
    </div>
    
    <div class="input-container">
      <div class="input-wrapper">
        <textarea id="input" placeholder="Type a message..." rows="1"></textarea>
        <button id="send" disabled>Send</button>
      </div>

    </div>
  </div>

  <script>
    const API_BASE = '/api/' + ${opencodePort};
    const SESSION_ID = '${safeSessionId}';
    
    const messageEl = document.getElementById('message');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const statusEl = document.getElementById('status');
    
    let isSending = false;
    
    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
      sendBtn.disabled = !inputEl.value.trim() || isSending;
    });
    
    // Send message
    async function sendMessage() {
      const content = inputEl.value.trim();
      if (!content || isSending) return;
      
      isSending = true;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
      
      try {
        // OpenCode's /message endpoint waits for LLM response, which can take minutes.
        // Use AbortController with short timeout - if request is accepted, message is queued.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        let requestAccepted = false;
        try {
          const res = await fetch(API_BASE + '/session/' + SESSION_ID + '/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts: [{ type: 'text', text: content }] }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error('Failed to send');
          requestAccepted = true;
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          // AbortError means request was sent but we timed out waiting for LLM response
          // This is expected - the message was accepted and is being processed
          if (fetchErr.name === 'AbortError') {
            requestAccepted = true;
          } else {
            throw fetchErr;
          }
        }
        
        if (requestAccepted) {
          inputEl.value = '';
          inputEl.style.height = 'auto';
          statusEl.textContent = 'Sent! Check OpenCode for response.';
          
          // Show user message immediately
          messageEl.innerHTML = \`
            <div class="message-header">
              <span class="message-role" style="background:#1f6feb">You</span>
              <span>Just now</span>
            </div>
            <div class="message-content">\${escapeHtml(content)}</div>
          \`;
        }
      } catch (err) {
        statusEl.textContent = 'Failed to send';
        messageEl.classList.add('message-error');
      } finally {
        isSending = false;
        sendBtn.disabled = !inputEl.value.trim();
        sendBtn.textContent = 'Send';
      }
    }
    
    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    
    // Load session messages
    async function loadSession() {
      try {
        // Fetch messages from the /message endpoint (not embedded in session)
        const res = await fetch(API_BASE + '/session/' + SESSION_ID + '/message');
        if (!res.ok) throw new Error('Session not found');
        
        const messages = await res.json();
        
        // Find last assistant message (role is in message.info.role)
        let lastAssistant = null;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].info && messages[i].info.role === 'assistant') {
            lastAssistant = messages[i];
            break;
          }
        }
        
        if (lastAssistant) {
          // Extract text content from message parts
          let content = '';
          if (lastAssistant.parts) {
            for (const part of lastAssistant.parts) {
              if (part.type === 'text') {
                content += part.text;
              }
            }
          }
          
          messageEl.innerHTML = \`
            <div class="message-header">
              <span class="message-role">Assistant</span>
            </div>
            <div class="message-content">\${escapeHtml(content || 'No content')}</div>
          \`;
          statusEl.textContent = 'Ready';
        } else {
          messageEl.innerHTML = '<div class="message-loading">No messages yet</div>';
          statusEl.textContent = 'New session';
        }
        
        sendBtn.disabled = !inputEl.value.trim();
      } catch (err) {
        messageEl.innerHTML = '<div class="message-loading">Could not load session</div>';
        messageEl.classList.add('message-error');
        statusEl.textContent = 'Error';
      }
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    loadSession();
  </script>
</body>
</html>`
}

/**
 * Generate the new session page HTML
 * @param {Object} params - Page parameters
 * @param {number} params.opencodePort - OpenCode server port
 * @returns {string} HTML content
 */
function newSessionPage({ opencodePort }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>New Session - OpenCode</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: #161b22;
      padding: 12px 16px;
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header-icon {
      width: 20px;
      height: 20px;
      background: #238636;
      border-radius: 4px;
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
    }
    .header-status {
      margin-left: auto;
      font-size: 12px;
      color: #7d8590;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 16px;
      gap: 16px;
      overflow-y: auto;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    label {
      font-size: 13px;
      font-weight: 500;
      color: #7d8590;
    }
    select {
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-family: inherit;
      font-size: 15px;
      padding: 10px 12px;
      width: 100%;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%237d8590' viewBox='0 0 16 16'%3E%3Cpath d='M4.5 6l3.5 4 3.5-4z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
    }
    select:focus {
      outline: none;
      border-color: #238636;
    }
    select:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    textarea {
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-family: inherit;
      font-size: 15px;
      padding: 10px 12px;
      resize: vertical;
      min-height: 120px;
      width: 100%;
    }
    textarea:focus {
      outline: none;
      border-color: #238636;
    }
    textarea::placeholder {
      color: #7d8590;
    }
    button {
      background: #238636;
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 20px;
      cursor: pointer;
      width: 100%;
    }
    button:hover {
      background: #2ea043;
    }
    button:disabled {
      background: #21262d;
      color: #7d8590;
      cursor: not-allowed;
    }
    .error {
      background: #3d1e20;
      border: 1px solid #f85149;
      border-radius: 6px;
      color: #f85149;
      padding: 12px;
      font-size: 14px;
      display: none;
    }
    .success {
      background: #1e3d20;
      border: 1px solid #238636;
      border-radius: 6px;
      color: #3fb950;
      padding: 12px;
      font-size: 14px;
      display: none;
      text-align: center;
    }
    .loading {
      color: #7d8590;
      font-size: 14px;
      text-align: center;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-icon"></div>
    <div class="header-title">New Session</div>
    <div class="header-status" id="status">Loading...</div>
  </div>
  
  <div class="main">
    <div class="error" id="error"></div>
    <div class="success" id="success">Session started! You can close this page.</div>
    
    <div class="form-group">
      <label for="project">Project Directory</label>
      <select id="project" disabled>
        <option value="">Loading projects...</option>
      </select>
    </div>
    
    <div class="form-group">
      <label for="model">Model</label>
      <select id="model" disabled>
        <option value="">Loading models...</option>
      </select>
    </div>
    
    <div class="form-group">
      <label for="agent">Agent</label>
      <select id="agent" disabled>
        <option value="">Loading agents...</option>
      </select>
    </div>
    
    <div class="form-group">
      <label for="message">Message</label>
      <textarea id="message" placeholder="What would you like to do?" rows="4"></textarea>
    </div>
    
    <button id="submit" disabled>Start Session</button>
  </div>

  <script>
    const API_BASE = '/api/${opencodePort}';
    
    const projectEl = document.getElementById('project');
    const modelEl = document.getElementById('model');
    const agentEl = document.getElementById('agent');
    const messageEl = document.getElementById('message');
    const submitBtn = document.getElementById('submit');
    const statusEl = document.getElementById('status');
    const errorEl = document.getElementById('error');
    const successEl = document.getElementById('success');
    
    let projects = [];
    let models = [];
    let agents = [];
    
    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
      successEl.style.display = 'none';
    }
    
    function showSuccess() {
      successEl.style.display = 'block';
      errorEl.style.display = 'none';
    }
    
    function hideMessages() {
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
    }
    
    function updateSubmitButton() {
      const hasProject = projectEl.value;
      const hasMessage = messageEl.value.trim();
      submitBtn.disabled = !hasProject || !hasMessage;
    }
    
    async function loadProjects() {
      try {
        const res = await fetch(API_BASE + '/project');
        if (!res.ok) throw new Error('Failed to load projects');
        projects = await res.json();
        
        // Filter projects:
        // - Exclude .cache/devcontainer-clones (temporary workspaces)
        // - Only show projects under home directory OR global "/"
        const home = '/Users/';
        const filtered = projects.filter(p => {
          if (p.worktree === '/') return true; // Keep global project
          if (p.worktree.includes('/.cache/')) return false;
          if (!p.worktree.startsWith(home)) return false;
          return true;
        });
        
        projectEl.innerHTML = '<option value="">Select a project...</option>';
        filtered.forEach(p => {
          let name = p.worktree.split('/').pop() || p.worktree;
          const isGlobal = p.worktree === '/';
          if (isGlobal) name = '~ (global)';
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = name;
          opt.title = p.worktree;
          if (isGlobal) opt.selected = true;
          projectEl.appendChild(opt);
        });
        projectEl.disabled = false;
      } catch (err) {
        projectEl.innerHTML = '<option value="">Failed to load</option>';
        showError('Could not load projects. Is OpenCode running?');
      }
    }
    
    async function loadModels() {
      try {
        // Load favorites and provider data in parallel
        const [favRes, provRes] = await Promise.all([
          fetch('/favorites'),
          fetch(API_BASE + '/provider')
        ]);
        
        const favorites = favRes.ok ? await favRes.json() : [];
        if (!provRes.ok) throw new Error('Failed to load providers');
        const data = await provRes.json();
        
        const allProviders = data.all || [];
        
        modelEl.innerHTML = '';
        
        // Add favorite models first
        if (favorites.length > 0) {
          favorites.forEach(fav => {
            const provider = allProviders.find(p => p.id === fav.providerID);
            if (!provider || !provider.models) return;
            const model = provider.models[fav.modelID];
            if (!model) return;
            
            const opt = document.createElement('option');
            opt.value = fav.providerID + '/' + fav.modelID;
            opt.textContent = model.name || fav.modelID;
            modelEl.appendChild(opt);
          });
        } else {
          // Fallback if no favorites
          modelEl.innerHTML = '<option value="">Default model</option>';
        }
        
        modelEl.disabled = false;
      } catch (err) {
        modelEl.innerHTML = '<option value="">Default model</option>';
        modelEl.disabled = false;
      }
    }
    
    async function loadAgents() {
      try {
        const res = await fetch(API_BASE + '/agent');
        if (!res.ok) throw new Error('Failed to load agents');
        agents = await res.json();
        
        // Filter to user-facing agents:
        // - mode === 'primary' (not subagents)
        // - has a description (excludes internal agents like compaction, title, summary)
        const primaryAgents = agents.filter(a => a.mode === 'primary' && a.description);
        
        agentEl.innerHTML = '';
        primaryAgents.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.name;
          opt.textContent = a.name;
          if (a.name === 'plan') opt.selected = true;
          agentEl.appendChild(opt);
        });
        agentEl.disabled = false;
      } catch (err) {
        agentEl.innerHTML = '<option value="build">build</option>';
        agentEl.disabled = false;
      }
    }
    
    async function startSession() {
      hideMessages();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Starting...';
      statusEl.textContent = 'Creating session...';
      
      try {
        // Create session
        const sessionRes = await fetch(API_BASE + '/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectID: projectEl.value })
        });
        
        if (!sessionRes.ok) {
          const errText = await sessionRes.text();
          throw new Error('Create session failed: ' + sessionRes.status + ' ' + errText.substring(0, 100));
        }
        const session = await sessionRes.json();
        
        statusEl.textContent = 'Sending message...';
        
        // Parse model selection (format: "providerId/modelId")
        const modelValue = modelEl.value;
        const modelParts = modelValue ? modelValue.split('/') : [];
        const modelConfig = modelParts.length >= 2 ? {
          providerID: modelParts[0],
          modelID: modelParts.slice(1).join('/')
        } : null;
        
        // Send message with fire-and-forget approach
        // The message API waits for the LLM response which can take minutes
        // We use a short timeout to detect if the request was accepted
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const messageBody = {
          agent: agentEl.value,
          parts: [{ type: 'text', text: messageEl.value.trim() }]
        };
        if (modelConfig) {
          messageBody.model = modelConfig;
        }
        
        try {
          const msgRes = await fetch(API_BASE + '/session/' + session.id + '/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageBody),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          
          if (!msgRes.ok) {
            const errText = await msgRes.text();
            throw new Error('Send message failed: ' + msgRes.status + ' ' + errText.substring(0, 100));
          }
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          // AbortError means the request was sent but we timed out waiting
          // This is expected - the session is running, we just didn't wait for completion
          if (fetchErr.name !== 'AbortError') {
            throw fetchErr;
          }
        }
        
        showSuccess();
        statusEl.textContent = 'Session started!';
        messageEl.value = '';
        updateSubmitButton();
        
      } catch (err) {
        // Provide detailed error info for debugging
        const errMsg = err.message || String(err);
        const errName = err.name || 'Unknown';
        showError(errName + ': ' + errMsg);
        statusEl.textContent = 'Error';
        console.error('Session start error:', err);
      } finally {
        submitBtn.textContent = 'Start Session';
        updateSubmitButton();
      }
    }
    
    projectEl.addEventListener('change', updateSubmitButton);
    messageEl.addEventListener('input', updateSubmitButton);
    submitBtn.addEventListener('click', startSession);
    
    // Load data
    Promise.all([loadProjects(), loadModels(), loadAgents()]).then(() => {
      statusEl.textContent = 'Ready';
      updateSubmitButton();
    });
  </script>
</body>
</html>`
}

/**
 * Create a nonce for a permission request
 * @param {string} sessionId - OpenCode session ID
 * @param {string} permissionId - Permission request ID
 * @returns {string} The generated nonce
 */
function createNonce(sessionId, permissionId) {
  const nonce = randomUUID()
  nonces.set(nonce, {
    sessionId,
    permissionId,
    createdAt: Date.now(),
  })
  return nonce
}

/**
 * Consume a nonce, returning its data if valid
 * @param {string} nonce - The nonce to consume
 * @returns {Object|null} { sessionId, permissionId } or null if invalid/expired
 */
function consumeNonce(nonce) {
  const data = nonces.get(nonce)
  if (!data) return null
  
  nonces.delete(nonce)
  
  if (Date.now() - data.createdAt > NONCE_TTL_MS) {
    return null
  }
  
  return {
    sessionId: data.sessionId,
    permissionId: data.permissionId,
  }
}

/**
 * Clean up expired nonces
 * @returns {number} Number of expired nonces removed
 */
function cleanupNonces() {
  const now = Date.now()
  let removed = 0
  
  for (const [nonce, data] of nonces) {
    if (now - data.createdAt > NONCE_TTL_MS) {
      nonces.delete(nonce)
      removed++
    }
  }
  
  return removed
}

/**
 * Register a session connection
 * @param {string} sessionId - OpenCode session ID
 * @param {net.Socket} socket - Socket connection to the plugin
 */
function registerSession(sessionId, socket) {
  console.log(`[opencode-ntfy] Session registered: ${sessionId}`)
  sessions.set(sessionId, socket)
  
  socket.on('close', () => {
    console.log(`[opencode-ntfy] Session disconnected: ${sessionId}`)
    sessions.delete(sessionId)
  })
}

/**
 * Send a permission response to a session
 * @param {string} sessionId - OpenCode session ID
 * @param {string} permissionId - Permission request ID
 * @param {string} response - Response type: 'once' | 'always' | 'reject'
 * @returns {boolean} True if sent successfully
 */
function sendToSession(sessionId, permissionId, response) {
  const socket = sessions.get(sessionId)
  if (!socket) {
    console.warn(`[opencode-ntfy] Session not found: ${sessionId}`)
    return false
  }
  
  try {
    const message = JSON.stringify({
      type: 'permission_response',
      permissionId,
      response,
    })
    socket.write(message + '\n')
    return true
  } catch (error) {
    console.error(`[opencode-ntfy] Failed to send to session ${sessionId}: ${error.message}`)
    return false
  }
}

/**
 * Proxy a request to the OpenCode server
 * @param {http.IncomingMessage} req - Incoming request
 * @param {http.ServerResponse} res - Outgoing response
 * @param {number} targetPort - Target port for OpenCode server
 * @param {string} targetPath - Target path on the OpenCode server
 */
async function proxyToOpenCode(req, res, targetPort, targetPath) {
  // Validate port to prevent localhost port scanning
  if (!isValidPort(targetPort)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid port' }))
    return
  }
  
  try {
    // Read request body for POST/PUT requests with size limit
    let body = null
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = []
      let totalSize = 0
      for await (const chunk of req) {
        totalSize += chunk.length
        if (totalSize > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Request body too large' }))
          return
        }
        chunks.push(chunk)
      }
      body = Buffer.concat(chunks)
    }
    
    // Make request to OpenCode
    const targetUrl = `http://localhost:${targetPort}${targetPath}`
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Accept': 'application/json',
      },
    }
    if (body) {
      fetchOptions.body = body
    }
    
    const proxyRes = await fetch(targetUrl, fetchOptions)
    
    // Forward response
    const responseBody = await proxyRes.text()
    res.writeHead(proxyRes.status, {
      'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(responseBody)
  } catch (error) {
    console.error(`[opencode-ntfy] Proxy error: ${error.message}`)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Failed to connect to OpenCode server' }))
  }
}

/**
 * Create the HTTP callback server
 * @param {number} port - Port to listen on
 * @returns {http.Server} The HTTP server
 */
function createCallbackServer(port) {
  const callbackConfig = loadCallbackConfig()
  
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    
    // Redirect to HTTPS if configured and request came directly to HTTP port
    // (Tailscale Serve handles HTTPS termination and forwards to us)
    // We detect direct HTTP access by checking the X-Forwarded-Proto header
    // which Tailscale Serve sets when proxying
    // Exception: /health endpoint always works on HTTP for monitoring
    if (callbackConfig.callbackHttps && callbackConfig.callbackHost && url.pathname !== '/health') {
      const forwardedProto = req.headers['x-forwarded-proto']
      // If no forwarded proto header, request came directly to HTTP port
      if (!forwardedProto) {
        const httpsUrl = `https://${callbackConfig.callbackHost}${url.pathname}${url.search}`
        res.writeHead(301, { 'Location': httpsUrl })
        res.end()
        return
      }
    }
    
    // OPTIONS - CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }
    
    // GET /health - Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }
    
    // GET /favorites - Get favorite models from local OpenCode state
    if (req.method === 'GET' && url.pathname === '/favorites') {
      try {
        const modelFile = join(homedir(), '.local', 'state', 'opencode', 'model.json')
        if (existsSync(modelFile)) {
          const data = JSON.parse(readFileSync(modelFile, 'utf8'))
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          })
          res.end(JSON.stringify(data.favorite || []))
        } else {
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          })
          res.end('[]')
        }
      } catch (err) {
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        })
        res.end('[]')
      }
      return
    }
    
    // GET or POST /callback - Permission response from ntfy
    // GET is used by 'view' actions (opens in browser), POST by 'http' actions
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/callback') {
      const nonce = url.searchParams.get('nonce')
      const response = url.searchParams.get('response')
      
      // Validate required params
      if (!nonce || !response) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Error', 'Missing required parameters', false))
        return
      }
      
      // Validate response value
      if (!VALID_RESPONSES.includes(response)) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Error', 'Invalid response value', false))
        return
      }
      
      // Validate and consume nonce
      const payload = consumeNonce(nonce)
      if (!payload) {
        res.writeHead(401, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Error', 'Invalid or expired nonce', false))
        return
      }
      
      // Forward to session
      const sent = sendToSession(payload.sessionId, payload.permissionId, response)
      if (sent) {
        const actionLabel = response === 'once' ? 'Allowed (once)' : response === 'always' ? 'Allowed (always)' : 'Rejected'
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Done', actionLabel, true))
      } else {
        res.writeHead(503, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Error', 'Session not connected', false))
      }
      return
    }
    
    // GET /m/:port/:repo/session/:sessionId - Mobile session UI
    const mobileMatch = url.pathname.match(/^\/m\/(\d+)\/([^/]+)\/session\/([^/]+)$/)
    if (req.method === 'GET' && mobileMatch) {
      const [, portStr, repoName, sessionId] = mobileMatch
      const opencodePort = parseInt(portStr, 10)
      
      // Validate port to prevent abuse
      if (!isValidPort(opencodePort)) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Error', 'Invalid port', false))
        return
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(mobileSessionPage({
        repoName: decodeURIComponent(repoName),
        sessionId,
        opencodePort,
      }))
      return
    }
    
    // API Proxy routes - /api/:port/session/:sessionId
    const apiSessionMatch = url.pathname.match(/^\/api\/(\d+)\/session\/([^/]+)$/)
    if (apiSessionMatch) {
      const [, opencodePort, sessionId] = apiSessionMatch
      await proxyToOpenCode(req, res, parseInt(opencodePort, 10), `/session/${sessionId}`)
      return
    }
    
    // API Proxy routes - /api/:port/session/:sessionId/chat
    const apiChatMatch = url.pathname.match(/^\/api\/(\d+)\/session\/([^/]+)\/chat$/)
    if (apiChatMatch) {
      const [, opencodePort, sessionId] = apiChatMatch
      await proxyToOpenCode(req, res, parseInt(opencodePort, 10), `/session/${sessionId}/chat`)
      return
    }
    
    // API Proxy routes - /api/:port/session/:sessionId/message (for new session page)
    const apiMessageMatch = url.pathname.match(/^\/api\/(\d+)\/session\/([^/]+)\/message$/)
    if (apiMessageMatch) {
      const [, opencodePort, sessionId] = apiMessageMatch
      await proxyToOpenCode(req, res, parseInt(opencodePort, 10), `/session/${sessionId}/message`)
      return
    }
    
    // API Proxy routes - /api/:port/session (create session)
    const apiSessionCreateMatch = url.pathname.match(/^\/api\/(\d+)\/session$/)
    if (apiSessionCreateMatch) {
      const [, opencodePort] = apiSessionCreateMatch
      await proxyToOpenCode(req, res, parseInt(opencodePort, 10), '/session')
      return
    }
    
    // API Proxy routes - /api/:port/project (list projects)
    const apiProjectMatch = url.pathname.match(/^\/api\/(\d+)\/project$/)
    if (apiProjectMatch) {
      const [, opencodePort] = apiProjectMatch
      await proxyToOpenCode(req, res, parseInt(opencodePort, 10), '/project')
      return
    }
    
    // API Proxy routes - /api/:port/agent (list agents)
    const apiAgentMatch = url.pathname.match(/^\/api\/(\d+)\/agent$/)
    if (apiAgentMatch) {
      const [, opencodePort] = apiAgentMatch
      await proxyToOpenCode(req, res, parseInt(opencodePort, 10), '/agent')
      return
    }
    
    // API Proxy routes - /api/:port/provider (list providers/models)
    const apiProviderMatch = url.pathname.match(/^\/api\/(\d+)\/provider$/)
    if (apiProviderMatch) {
      const [, opencodePort] = apiProviderMatch
      await proxyToOpenCode(req, res, parseInt(opencodePort, 10), '/provider')
      return
    }
    
    // GET /new/:port - New session page
    const newSessionMatch = url.pathname.match(/^\/new\/(\d+)$/)
    if (req.method === 'GET' && newSessionMatch) {
      const [, portStr] = newSessionMatch
      const opencodePort = parseInt(portStr, 10)
      
      if (!isValidPort(opencodePort)) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Error', 'Invalid port', false))
        return
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(newSessionPage({ opencodePort }))
      return
    }
    
    // GET /new - New session page (default port from query param or config)
    if (req.method === 'GET' && url.pathname === '/new') {
      // Try to get port from query param, default to common OpenCode ports
      const portParam = url.searchParams.get('port')
      const opencodePort = portParam ? parseInt(portParam, 10) : 4096
      
      if (!isValidPort(opencodePort)) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(htmlResponse('Error', 'Invalid port', false))
        return
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(newSessionPage({ opencodePort }))
      return
    }
    
    // Unknown route
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })
  
  server.on('error', (err) => {
    console.error(`[opencode-ntfy] HTTP server error: ${err.message}`)
  })
  
  return server
}

/**
 * Create the Unix socket server for IPC
 * @param {string} socketPath - Path to the socket file
 * @returns {net.Server} The socket server
 */
function createSocketServer(socketPath) {
  const server = createNetServer((socket) => {
    console.log('[opencode-ntfy] Plugin connected')
    
    let buffer = ''
    
    socket.on('data', (data) => {
      buffer += data.toString()
      
      // Process complete messages (newline-delimited JSON)
      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        
        if (!line.trim()) continue
        
        try {
          const message = JSON.parse(line)
          handleSocketMessage(socket, message)
        } catch (error) {
          console.warn(`[opencode-ntfy] Invalid message: ${error.message}`)
        }
      }
    })
    
    socket.on('error', (err) => {
      console.warn(`[opencode-ntfy] Socket error: ${err.message}`)
    })
  })
  
  server.on('error', (err) => {
    console.error(`[opencode-ntfy] Socket server error: ${err.message}`)
  })
  
  return server
}

/**
 * Handle a message from a plugin
 * @param {net.Socket} socket - The socket connection
 * @param {Object} message - The parsed message
 */
function handleSocketMessage(socket, message) {
  switch (message.type) {
    case 'register':
      if (message.sessionId) {
        registerSession(message.sessionId, socket)
        socket.write(JSON.stringify({ type: 'registered', sessionId: message.sessionId }) + '\n')
      }
      break
      
    case 'create_nonce':
      if (message.sessionId && message.permissionId) {
        const nonce = createNonce(message.sessionId, message.permissionId)
        socket.write(JSON.stringify({ type: 'nonce_created', nonce, permissionId: message.permissionId }) + '\n')
      }
      break
      
    default:
      console.warn(`[opencode-ntfy] Unknown message type: ${message.type}`)
  }
}

/**
 * Start the callback service
 * @param {Object} config - Configuration options
 * @param {number} [config.httpPort] - HTTP server port (default: 4097)
 * @param {string} [config.socketPath] - Unix socket path (default: /tmp/opencode-ntfy.sock)
 * @returns {Promise<Object>} Service instance with httpServer, socketServer, and cleanup interval
 */
export async function startService(config = {}) {
  const httpPort = config.httpPort ?? DEFAULT_HTTP_PORT
  const socketPath = config.socketPath ?? DEFAULT_SOCKET_PATH
  
  // Clean up stale socket file
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch (err) {
      console.warn(`[opencode-ntfy] Could not remove stale socket: ${err.message}`)
    }
  }
  
  // Create servers
  const httpServer = createCallbackServer(httpPort)
  const socketServer = createSocketServer(socketPath)
  
  // Start HTTP server
  await new Promise((resolve, reject) => {
    httpServer.listen(httpPort, () => {
      const actualPort = httpServer.address().port
      console.log(`[opencode-ntfy] HTTP server listening on port ${actualPort}`)
      resolve()
    })
    httpServer.once('error', reject)
  })
  
  // Start socket server
  await new Promise((resolve, reject) => {
    socketServer.listen(socketPath, () => {
      console.log(`[opencode-ntfy] Socket server listening at ${socketPath}`)
      resolve()
    })
    socketServer.once('error', reject)
  })
  
  // Start periodic nonce cleanup
  const cleanupInterval = setInterval(() => {
    const removed = cleanupNonces()
    if (removed > 0) {
      console.log(`[opencode-ntfy] Cleaned up ${removed} expired nonces`)
    }
  }, 60 * 1000) // Every minute
  
  return {
    httpServer,
    socketServer,
    cleanupInterval,
    socketPath,
  }
}

/**
 * Stop the callback service
 * @param {Object} service - Service instance from startService
 */
export async function stopService(service) {
  if (service.cleanupInterval) {
    clearInterval(service.cleanupInterval)
  }
  
  if (service.httpServer) {
    await new Promise((resolve) => {
      service.httpServer.close(resolve)
    })
  }
  
  if (service.socketServer) {
    await new Promise((resolve) => {
      service.socketServer.close(resolve)
    })
  }
  
  // Clean up socket file
  if (service.socketPath && existsSync(service.socketPath)) {
    try {
      unlinkSync(service.socketPath)
    } catch (err) {
      // Ignore errors
    }
  }
  
  console.log('[opencode-ntfy] Service stopped')
}

// If run directly, start the service
// Use realpath comparison to handle symlinks (e.g., /tmp vs /private/tmp on macOS,
// or /opt/homebrew/opt vs /opt/homebrew/Cellar)
function isMainModule() {
  try {
    const currentFile = realpathSync(fileURLToPath(import.meta.url))
    const argvFile = realpathSync(process.argv[1])
    return currentFile === argvFile
  } catch {
    return false
  }
}

if (isMainModule()) {
  const config = {
    httpPort: parseInt(process.env.NTFY_CALLBACK_PORT || '4097', 10),
    socketPath: process.env.NTFY_SOCKET_PATH || DEFAULT_SOCKET_PATH,
  }
  
  console.log('[opencode-ntfy] Starting callback service...')
  
  const service = await startService(config)
  
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[opencode-ntfy] Received SIGTERM, shutting down...')
    await stopService(service)
    process.exit(0)
  })
  
  process.on('SIGINT', async () => {
    console.log('[opencode-ntfy] Received SIGINT, shutting down...')
    await stopService(service)
    process.exit(0)
  })
}
