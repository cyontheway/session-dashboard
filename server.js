const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

const SOURCES = {
  live: path.join(os.homedir(), '.claude', 'projects'),
};

// Optional: set BACKUP_DIR env var to enable backup source
// e.g. BACKUP_DIR=~/my-backup/projects node server.js
if (process.env.BACKUP_DIR) {
  SOURCES.backup = process.env.BACKUP_DIR.replace(/^~/, os.homedir());
}

let currentSource = 'live';
let CLAUDE_PROJECTS_DIR = SOURCES.live;

// Data source switching
app.get('/api/source', (req, res) => res.json({
  source: currentSource,
  path: CLAUDE_PROJECTS_DIR,
  available: Object.keys(SOURCES),
}));
app.post('/api/source', (req, res) => {
  const s = req.body.source;
  if (!SOURCES[s]) return res.status(400).json({ error: 'Invalid source. Use "live" or "backup".' });
  currentSource = s;
  CLAUDE_PROJECTS_DIR = SOURCES[s];
  searchCache.clear();
  res.json({ source: currentSource, path: CLAUDE_PROJECTS_DIR });
});

// Clear search cache (called on refresh to free memory)
app.post('/api/clear-cache', (req, res) => {
  searchCache.clear();
  if (global.gc) global.gc();
  res.json({ ok: true });
});

app.use(express.static('public'));

// Path traversal guard: resolve and verify the path stays within base
function safePath(base, ...segments) {
  const resolved = path.resolve(base, ...segments);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    return null;
  }
  return resolved;
}

// Decode project directory name back to readable path
function decodeProjectDir(dirName) {
  // The encoding: path separators become '-', leading to patterns like -Users-xxx
  // We reverse: replace leading '-' then split by '-'
  const parts = dirName.split('-');
  let decoded = '';
  let i = 0;
  // Skip leading empty part from first '-'
  if (parts[0] === '') i = 1;
  for (; i < parts.length; i++) {
    decoded += '/' + parts[i];
  }
  return decoded || dirName;
}

// GET /api/projects — list all projects with session counts
app.get('/api/projects', async (req, res) => {
  try {
    const entries = await fs.promises.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projPath = path.join(CLAUDE_PROJECTS_DIR, entry.name);
      const files = (await fs.promises.readdir(projPath)).filter(f => f.endsWith('.jsonl'));
      const decodedPath = decodeProjectDir(entry.name);

      // Get last modified time from most recent jsonl
      let lastModified = null;
      for (const f of files) {
        const stat = await fs.promises.stat(path.join(projPath, f));
        if (!lastModified || stat.mtimeMs > lastModified) {
          lastModified = stat.mtimeMs;
        }
      }

      projects.push({
        id: entry.name,
        path: decodedPath,
        name: decodedPath.split('/').filter(Boolean).pop() || decodedPath,
        sessionCount: files.length,
        lastModified: lastModified ? new Date(lastModified).toISOString() : null,
      });
    }

    // Sort by last modified descending
    projects.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:projectId/sessions — list sessions for a project
app.get('/api/projects/:projectId/sessions', async (req, res) => {
  try {
    const projDir = safePath(CLAUDE_PROJECTS_DIR, req.params.projectId);
    if (!projDir) return res.status(403).json({ error: 'Invalid project path' });

    try {
      await fs.promises.access(projDir);
    } catch {
      return res.status(404).json({ error: 'Project not found' });
    }

    const files = (await fs.promises.readdir(projDir)).filter(f => f.endsWith('.jsonl'));
    const sessions = [];

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(projDir, file);
      const stat = await fs.promises.stat(filePath);

      // Quick scan: read first and last few lines for metadata
      const meta = await scanSessionMeta(filePath);

      sessions.push({
        id: sessionId,
        file: file,
        size: stat.size,
        lastModified: stat.mtime.toISOString(),
        messageCount: meta.messageCount,
        title: meta.title || meta.firstUserMessage || sessionId.slice(0, 8),
        firstUserMessage: meta.firstUserMessage,
        startTime: meta.startTime,
        isEmpty: meta.isEmpty,
      });
    }

    // Sort by last modified descending
    sessions.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:projectId/sessions/:sessionId — get full session messages
app.get('/api/projects/:projectId/sessions/:sessionId', async (req, res) => {
  try {
    const filePath = safePath(
      CLAUDE_PROJECTS_DIR,
      req.params.projectId,
      req.params.sessionId + '.jsonl'
    );
    if (!filePath) return res.status(403).json({ error: 'Invalid path' });

    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messages = await parseSessionMessages(filePath);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detect if a user message is a CLI internal command (not real user input)
function isInternalMessage(text) {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  // CLI internal commands: local-command, /clear, Warmup, caveat wrappers
  if (/^<(local-command|command-name|local-command-caveat|local-command-stdout)/.test(t)) return true;
  if (/^Warmup$/i.test(t)) return true;
  return false;
}

// Scan a JSONL file for quick metadata (title, message count, first user msg)
async function scanSessionMeta(filePath) {
  return new Promise((resolve) => {
    let messageCount = 0;
    let title = '';
    let firstUserMessage = '';
    let startTime = null;
    let hasRealUserMessage = false;

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        const d = JSON.parse(line);
        if (d.type === 'user' || d.type === 'assistant') {
          messageCount++;
          if (d.type === 'user') {
            const raw = extractText(d.message?.content);
            if (!isInternalMessage(raw)) {
              hasRealUserMessage = true;
              if (!firstUserMessage) {
                firstUserMessage = raw.slice(0, 120).replace(/<[^>]+>/g, '').trim();
              }
            }
          }
          if (!startTime && d.timestamp) {
            startTime = d.timestamp;
          }
        }
        if (d.type === 'summary' && d.summary) {
          title = d.summary;
        }
      } catch {}
    });

    rl.on('close', () => {
      const isEmpty = messageCount === 0 || !hasRealUserMessage;
      resolve({ messageCount, title, firstUserMessage, startTime, isEmpty });
    });

    rl.on('error', () => {
      resolve({ messageCount: 0, title: '', firstUserMessage: '', startTime: null, isEmpty: true });
    });
  });
}

// Parse full session messages from JSONL
async function parseSessionMessages(filePath) {
  return new Promise((resolve) => {
    const messages = [];

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        const d = JSON.parse(line);
        if (d.type === 'user') {
          messages.push({
            role: 'user',
            content: extractText(d.message?.content),
            timestamp: d.timestamp,
          });
        } else if (d.type === 'assistant') {
          const content = d.message?.content;
          const parts = [];

          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                parts.push({ type: 'text', text: block.text });
              } else if (block.type === 'tool_use') {
                parts.push({
                  type: 'tool_use',
                  name: block.name,
                  input: summarizeToolInput(block.input),
                });
              } else if (block.type === 'tool_result') {
                parts.push({ type: 'tool_result', content: extractText(block.content) });
              }
            }
          } else if (typeof content === 'string') {
            parts.push({ type: 'text', text: content });
          }

          if (parts.length > 0) {
            messages.push({
              role: 'assistant',
              parts,
              model: d.message?.model,
              timestamp: d.timestamp,
            });
          }
        }
      } catch {}
    });

    rl.on('close', () => resolve(messages));
    rl.on('error', () => resolve([]));
  });
}

// Extract text from content (string or array of content blocks)
function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('\n');
  }
  return '';
}

// Summarize tool input for display (avoid huge payloads)
function summarizeToolInput(input) {
  if (!input) return '';
  if (typeof input === 'string') return input.slice(0, 200);
  // For objects, show key fields
  const summary = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      summary[k] = v.length > 150 ? v.slice(0, 150) + '...' : v;
    } else {
      summary[k] = JSON.stringify(v).slice(0, 100);
    }
  }
  return summary;
}

// ── Full-text search ──
const QUICK_SEARCH_LIMIT = 50; // number of recent files to scan in quick mode
const searchCache = new Map(); // projectId -> { texts: Map<sessionId, string>, builtAt }

// Extract all text from a JSONL file (user + assistant text only, no tool payloads)
async function extractSessionText(filePath) {
  return new Promise((resolve) => {
    const chunks = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      try {
        const d = JSON.parse(line);
        if (d.type === 'user' || d.type === 'assistant') {
          const text = extractText(d.message?.content);
          if (text) chunks.push(text);
        }
        if (d.type === 'summary' && d.summary) {
          chunks.push(d.summary);
        }
      } catch {}
    });
    rl.on('close', () => resolve(chunks.join('\n')));
    rl.on('error', () => resolve(''));
  });
}

// Get snippet around the match with context
function getSnippet(text, query, contextLen = 60) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - contextLen);
  const end = Math.min(text.length, idx + query.length + contextLen);
  let snippet = '';
  if (start > 0) snippet += '…';
  snippet += text.slice(start, end);
  if (end < text.length) snippet += '…';
  return snippet;
}

// GET /api/projects/:projectId/search?q=keyword&deep=0|1
app.get('/api/projects/:projectId/search', async (req, res) => {
  try {
    const projDir = safePath(CLAUDE_PROJECTS_DIR, req.params.projectId);
    if (!projDir) return res.status(403).json({ error: 'Invalid project path' });

    const query = (req.query.q || '').trim();
    if (!query) return res.json([]);

    const deep = req.query.deep === '1';
    const projectId = req.params.projectId;

    // List all JSONL files sorted by mtime desc
    const allFiles = (await fs.promises.readdir(projDir)).filter(f => f.endsWith('.jsonl'));
    const fileStats = await Promise.all(
      allFiles.map(async (f) => {
        const stat = await fs.promises.stat(path.join(projDir, f));
        return { file: f, mtimeMs: stat.mtimeMs, mtime: stat.mtime };
      })
    );
    fileStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const filesToScan = deep ? fileStats : fileStats.slice(0, QUICK_SEARCH_LIMIT);

    // For deep search, try cache first
    let cachedTexts = null;
    if (deep && searchCache.has(projectId)) {
      const cached = searchCache.get(projectId);
      // Cache valid for 5 minutes
      if (Date.now() - cached.builtAt < 5 * 60 * 1000) {
        cachedTexts = cached.texts;
      }
    }

    const results = [];
    const textsForCache = deep ? new Map() : null;

    for (const { file, mtime } of filesToScan) {
      const sessionId = file.replace('.jsonl', '');
      let text;

      if (cachedTexts && cachedTexts.has(sessionId)) {
        text = cachedTexts.get(sessionId);
      } else {
        text = await extractSessionText(path.join(projDir, file));
      }

      if (textsForCache) textsForCache.set(sessionId, text);

      // Match against session ID or text content
      const lowerQuery = query.toLowerCase();
      const matchesId = sessionId.toLowerCase().includes(lowerQuery);
      const matchesText = text.toLowerCase().includes(lowerQuery);

      if (matchesId || matchesText) {
        const snippet = matchesText ? getSnippet(text, query) : `Session ID: ${sessionId}`;
        results.push({
          sessionId,
          lastModified: mtime.toISOString(),
          snippet,
        });
      }

      if (results.length >= 100) break;
    }

    // Update cache for deep search
    if (deep && textsForCache) {
      searchCache.set(projectId, { texts: textsForCache, builtAt: Date.now() });
    }

    res.json({
      results,
      scanned: filesToScan.length,
      total: fileStats.length,
      deep,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Startup health check ──
async function healthCheck() {
  const warnings = [];

  // 1. Check projects directory exists
  try {
    await fs.promises.access(CLAUDE_PROJECTS_DIR);
  } catch {
    warnings.push(`Projects directory not found: ${CLAUDE_PROJECTS_DIR}`);
    return { ok: false, warnings };
  }

  // 2. Find any .jsonl file and verify structure
  const allEntries = await fs.promises.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  const dirs = allEntries.filter(d => d.isDirectory());
  if (dirs.length === 0) {
    warnings.push('No project directories found');
    return { ok: false, warnings };
  }

  let sampleChecked = false;
  for (const dir of dirs) {
    const jsonls = (await fs.promises.readdir(path.join(CLAUDE_PROJECTS_DIR, dir.name))).filter(f => f.endsWith('.jsonl'));
    if (jsonls.length === 0) continue;

    const samplePath = path.join(CLAUDE_PROJECTS_DIR, dir.name, jsonls[0]);
    const content = await fs.promises.readFile(samplePath, 'utf8');
    const firstLine = content.split('\n')[0];
    try {
      const parsed = JSON.parse(firstLine);
      if (!parsed.type) {
        warnings.push('JSONL structure changed: missing "type" field');
      }
    } catch {
      warnings.push('JSONL format changed: first line is not valid JSON');
    }
    sampleChecked = true;
    break;
  }

  if (!sampleChecked) {
    warnings.push('No .jsonl files found in any project');
  }

  // 3. Check directory naming convention
  const sampleDir = dirs[0].name;
  if (!sampleDir.startsWith('-')) {
    warnings.push(`Directory naming convention may have changed: "${sampleDir}" does not start with "-"`);
  }

  return { ok: warnings.length === 0, warnings };
}

// ── Export session as Markdown ──
app.get('/api/projects/:projectId/sessions/:sessionId/export', async (req, res) => {
  try {
    const filePath = safePath(
      CLAUDE_PROJECTS_DIR,
      req.params.projectId,
      req.params.sessionId + '.jsonl'
    );
    if (!filePath) return res.status(403).json({ error: 'Invalid path' });

    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messages = await parseSessionMessages(filePath);
    const meta = await scanSessionMeta(filePath);

    // Build Markdown content
    let md = `# ${meta.title || meta.firstUserMessage || req.params.sessionId}\n\n`;
    md += `**Session ID:** ${req.params.sessionId}\n`;
    md += `**Created:** ${meta.startTime || 'Unknown'}\n`;
    md += `**Messages:** ${meta.messageCount}\n\n`;
    md += `---\n\n`;

    for (const msg of messages) {
      if (msg.role === 'user') {
        md += `## 👤 User\n\n`;
        md += `${msg.content}\n\n`;
        if (msg.timestamp) {
          md += `*${new Date(msg.timestamp).toLocaleString('zh-CN')}*\n\n`;
        }
      } else if (msg.role === 'assistant') {
        md += `## 🤖 Assistant\n\n`;
        for (const part of msg.parts) {
          if (part.type === 'text') {
            md += `${part.text}\n\n`;
          } else if (part.type === 'tool_use') {
            md += `### 🔧 Tool: ${part.name}\n\n`;
            md += `\`\`\`json\n${JSON.stringify(part.input, null, 2)}\n\`\`\`\n\n`;
          } else if (part.type === 'tool_result') {
            md += `### 📋 Result\n\n`;
            md += `\`\`\`\n${part.content.slice(0, 1000)}${part.content.length > 1000 ? '\n...(truncated)' : ''}\n\`\`\`\n\n`;
          }
        }
        if (msg.timestamp) {
          md += `*${new Date(msg.timestamp).toLocaleString('zh-CN')}*\n\n`;
        }
      }
      md += `---\n\n`;
    }

    md += `\n*Exported from Session Dashboard*\n`;

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.sessionId}.md"`);
    res.send(md);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PI Agent API ──
const PI_SESSIONS_DIR = path.join(os.homedir(), '.pi', 'agent', 'sessions');

// List pi projects (directories under ~/.pi/agent/sessions/)
app.get('/api/pi/projects', async (req, res) => {
  try {
    const entries = await fs.promises.readdir(PI_SESSIONS_DIR, { withFileTypes: true }).catch(() => []);
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projPath = path.join(PI_SESSIONS_DIR, entry.name);
      const files = (await fs.promises.readdir(projPath)).filter(f => f.endsWith('.jsonl'));
      const decodedPath = decodeProjectDir(entry.name);

      let lastModified = null;
      for (const f of files) {
        const stat = await fs.promises.stat(path.join(projPath, f));
        if (!lastModified || stat.mtimeMs > lastModified) lastModified = stat.mtimeMs;
      }

      projects.push({
        id: entry.name,
        path: decodedPath,
        name: decodedPath.split('/').filter(Boolean).pop() || decodedPath,
        sessionCount: files.length,
        lastModified: lastModified ? new Date(lastModified).toISOString() : null,
      });
    }

    projects.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan pi session metadata
async function scanPiSessionMeta(filePath) {
  return new Promise((resolve) => {
    let messageCount = 0, firstUserMessage = '', startTime = null, hasRealUserMessage = false, model = '';
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    rl.on('line', (line) => {
      try {
        const d = JSON.parse(line);
        if (d.type === 'message') {
          messageCount++;
          const msg = d.message || {};
          if (msg.role === 'user') {
            const raw = extractText(msg.content);
            if (raw && !/^<(local-command|command-name|local-command-caveat|local-command-stdout)/.test(raw)) {
              hasRealUserMessage = true;
              if (!firstUserMessage) firstUserMessage = raw.slice(0, 120).replace(/<[^>]+>/g, '').trim();
            }
          }
          if (!startTime && d.timestamp) startTime = d.timestamp;
        } else if (d.type === 'model_change') {
          if (d.modelId) model = d.modelId;
        }
      } catch {}
    });
    rl.on('close', () => resolve({ messageCount, firstUserMessage, startTime, isEmpty: messageCount === 0 || !hasRealUserMessage, model }));
    rl.on('error', () => resolve({ messageCount: 0, firstUserMessage: '', startTime: null, isEmpty: true, model: '' }));
  });
}

// Parse pi session messages
async function parsePiSessionMessages(filePath) {
  return new Promise((resolve) => {
    const messages = [];
    let currentModel = '';
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    rl.on('line', (line) => {
      try {
        const d = JSON.parse(line);
        if (d.type === 'model_change') { if (d.modelId) currentModel = d.modelId; return; }
        if (d.type === 'session' || d.type === 'thinking_level_change') return;
        if (d.type === 'message') {
          const msg = d.message || {};
          const timestamp = d.timestamp || msg.timestamp;
          const content = msg.content;
          if (msg.role === 'user') {
            messages.push({ role: 'user', content: extractText(content), timestamp });
          } else if (msg.role === 'assistant') {
            const parts = [];
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) parts.push({ type: 'text', text: block.text });
                else if (block.type === 'tool_use') parts.push({ type: 'tool_use', name: block.name, input: summarizeToolInput(block.input) });
                else if (block.type === 'tool_result') parts.push({ type: 'tool_result', content: extractText(block.content) });
              }
            } else if (typeof content === 'string') {
              parts.push({ type: 'text', text: content });
            }
            if (parts.length > 0) messages.push({ role: 'assistant', parts, model: currentModel, timestamp });
          }
        }
      } catch {}
    });
    rl.on('close', () => resolve(messages));
    rl.on('error', () => resolve([]));
  });
}

// Extract all pi session text for search
async function extractPiSessionText(filePath) {
  return new Promise((resolve) => {
    const chunks = [];
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    rl.on('line', (line) => {
      try {
        const d = JSON.parse(line);
        if (d.type === 'message') { const text = extractText(d.message?.content); if (text) chunks.push(text); }
      } catch {}
    });
    rl.on('close', () => resolve(chunks.join('\n')));
    rl.on('error', () => resolve(''));
  });
}

// GET /api/pi/projects/:projectId/sessions — list sessions for a pi project
app.get('/api/pi/projects/:projectId/sessions', async (req, res) => {
  try {
    const projDir = safePath(PI_SESSIONS_DIR, req.params.projectId);
    if (!projDir) return res.status(403).json({ error: 'Invalid project path' });
    try { await fs.promises.access(projDir); } catch { return res.status(404).json({ error: 'Project not found' }); }

    const files = (await fs.promises.readdir(projDir)).filter(f => f.endsWith('.jsonl'));
    const fileStats = await Promise.all(files.map(async (f) => {
      const stat = await fs.promises.stat(path.join(projDir, f));
      return { file: f, mtimeMs: stat.mtimeMs };
    }));
    fileStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const sessions = [];
    for (const { file } of fileStats) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(projDir, file);
      const stat = await fs.promises.stat(filePath);
      const meta = await scanPiSessionMeta(filePath);
      sessions.push({
        id: sessionId, file, size: stat.size,
        lastModified: stat.mtime.toISOString(),
        messageCount: meta.messageCount, title: meta.firstUserMessage || sessionId.slice(0, 8),
        firstUserMessage: meta.firstUserMessage, startTime: meta.startTime,
        isEmpty: meta.isEmpty, model: meta.model, _isPi: true,
      });
    }
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/pi/sessions/:projectId/:sessionId — get full session messages
app.get('/api/pi/sessions/:projectId/:sessionId', async (req, res) => {
  try {
    const filePath = safePath(PI_SESSIONS_DIR, req.params.projectId, req.params.sessionId + '.jsonl');
    if (!filePath) return res.status(403).json({ error: 'Invalid path' });
    try { await fs.promises.access(filePath); } catch { return res.status(404).json({ error: 'Session not found' }); }
    const messages = await parsePiSessionMessages(filePath);
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/pi/sessions/:projectId/:sessionId/export — export as markdown
app.get('/api/pi/sessions/:projectId/:sessionId/export', async (req, res) => {
  try {
    const filePath = safePath(PI_SESSIONS_DIR, req.params.projectId, req.params.sessionId + '.jsonl');
    if (!filePath) return res.status(403).json({ error: 'Invalid path' });
    try { await fs.promises.access(filePath); } catch { return res.status(404).json({ error: 'Session not found' }); }
    const messages = await parsePiSessionMessages(filePath);
    let md = `# Pi Session\n\n**Session ID:** \${req.params.sessionId}\n**Messages:** \${messages.length}\n\n---\n\n`;
    for (const msg of messages) {
      if (msg.role === 'user') {
        md += `## 👤 User\n\n\${msg.content}\n\n`;
        if (msg.timestamp) md += `*\${new Date(msg.timestamp).toLocaleString('zh-CN')}*\n\n`;
      } else if (msg.role === 'assistant') {
        md += `## 🤖 Assistant\n\n`;
        for (const part of msg.parts || []) {
          if (part.type === 'text') md += `\${part.text}\n\n`;
          else if (part.type === 'tool_use') md += `### 🔧 Tool: \${part.name}\n\`\`\`json\n\${JSON.stringify(part.input, null, 2)}\n\`\`\`\n\n`;
        }
        if (msg.timestamp) md += `*\${new Date(msg.timestamp).toLocaleString('zh-CN')}*\n\n`;
      }
      md += `---\n\n`;
    }
    md += `\n*Exported from Session Dashboard*\n`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', \`attachment; filename="\${req.params.sessionId}-pi.md"\`);
    res.send(md);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/pi/search?q=&project= — search pi sessions
app.get('/api/pi/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) return res.json({ results: [], scanned: 0, total: 0 });
    const projectId = req.query.project;
    if (!projectId) return res.status(400).json({ error: 'Missing project parameter' });
    const projDir = safePath(PI_SESSIONS_DIR, projectId);
    if (!projDir) return res.status(403).json({ error: 'Invalid project path' });
    const allFiles = (await fs.promises.readdir(projDir)).filter(f => f.endsWith('.jsonl'));
    const fileStats = await Promise.all(allFiles.map(async (f) => {
      const stat = await fs.promises.stat(path.join(projDir, f));
      return { file: f, mtimeMs: stat.mtimeMs, mtime: stat.mtime };
    }));
    fileStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const results = [];
    const lowerQuery = query.toLowerCase();
    for (const { file, mtime } of fileStats) {
      const sessionId = file.replace('.jsonl', '');
      const text = await extractPiSessionText(path.join(projDir, file));
      if (text.toLowerCase().includes(lowerQuery) || sessionId.toLowerCase().includes(lowerQuery)) {
        const idx = text.toLowerCase().indexOf(lowerQuery);
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + query.length + 60);
        let snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
        results.push({ sessionId, lastModified: mtime.toISOString(), snippet });
      }
      if (results.length >= 100) break;
    }
    res.json({ results, scanned: fileStats.length, total: fileStats.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Expose health status via API
let healthStatus = { ok: true, warnings: [] };
app.get('/api/health', (req, res) => res.json(healthStatus));

const PORT = process.env.PORT || 3456;
(async () => {
  healthStatus = await healthCheck();
  if (!healthStatus.ok) {
    console.warn('⚠️  Health check warnings:');
    healthStatus.warnings.forEach(w => console.warn('   -', w));
  } else {
    console.log('✅ Health check passed');
  }
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Session Dashboard running at http://localhost:${PORT}`);
  });
})();
