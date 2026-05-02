// ── Tool category mapping ──
const TOOL_META = {
  Read:       { icon: '📖', cat: 'read',   label: 'Read' },
  Glob:       { icon: '🔍', cat: 'search', label: 'Glob' },
  Grep:       { icon: '🔎', cat: 'search', label: 'Grep' },
  Write:      { icon: '✏️', cat: 'write',  label: 'Write' },
  Edit:       { icon: '✏️', cat: 'write',  label: 'Edit' },
  MultiEdit:  { icon: '✏️', cat: 'write',  label: 'MultiEdit' },
  Bash:       { icon: '⚡', cat: 'exec',   label: 'Bash' },
  Task:       { icon: '🤖', cat: 'exec',   label: 'Task' },
  WebFetch:   { icon: '🌐', cat: 'read',   label: 'WebFetch' },
  WebSearch:  { icon: '🌐', cat: 'search', label: 'WebSearch' },
  TodoWrite:  { icon: '📝', cat: 'write',  label: 'TodoWrite' },
  NotebookEdit: { icon: '📓', cat: 'write', label: 'NotebookEdit' },
};
function getToolMeta(name) {
  return TOOL_META[name] || { icon: '🔧', cat: 'other', label: name };
}

// Get a short summary string for a tool's input
function toolSummaryText(name, input) {
  if (!input) return '';
  if (typeof input === 'string') return input.slice(0, 60);
  if (input.file_path) return input.file_path;
  if (input.command) return input.command.slice(0, 80);
  if (input.pattern) return input.pattern;
  if (input.query) return input.query;
  if (input.url) return input.url;
  if (input.content) return input.content.slice(0, 60) + '…';
  const keys = Object.keys(input);
  if (keys.length > 0) return `${keys[0]}: ${String(Object.values(input)[0]).slice(0, 50)}`;
  return '';
}

const API = '';
let allProjects = [];
let currentProjectId = null;
let currentSessions = [];
let currentSessionId = null;
let lastSearchResults = null; // holds search API results when active
let lastSearchQueryText = ''; // the query that produced lastSearchResults
let currentSourcePath = '~/.claude/projects'; // updated on source switch
let showEmpty = localStorage.getItem('sd-showEmpty') === 'true';

// Pagination
const PAGE_SIZE = 50;
let sessionsTotal = 0;
let isLoadingMore = false;

// ── Favorites (stored in localStorage) ──
let favorites = new Set(JSON.parse(localStorage.getItem('sd-favorites') || '[]'));

function toggleFavorite(sessionId) {
  if (favorites.has(sessionId)) {
    favorites.delete(sessionId);
  } else {
    favorites.add(sessionId);
  }
  localStorage.setItem('sd-favorites', JSON.stringify([...favorites]));
  // Re-render current view to update star icons
  if (currentProjectId === '__all__') {
    renderAllSessions(currentSessions);
  } else if (lastSearchResults) {
    renderSearchResults(lastSearchResults.results, lastSearchQueryText);
  } else {
    renderSessions(currentSessions);
  }
}

function isFavorite(sessionId) {
  return favorites.has(sessionId);
}

// ── Date filter ──
let dateFrom = null;
let dateTo = null;

function applyDateFilter(sessions) {
  if (!dateFrom && !dateTo) return sessions;

  return sessions.filter(s => {
    if (!s.lastModified) return false;
    const sessionDate = new Date(s.lastModified);

    if (dateFrom && sessionDate < dateFrom) return false;
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      if (sessionDate > endOfDay) return false;
    }

    return true;
  });
}

document.getElementById('date-from').addEventListener('change', (e) => {
  dateFrom = e.target.value ? new Date(e.target.value) : null;
  refreshCurrentView();
});

document.getElementById('date-to').addEventListener('change', (e) => {
  dateTo = e.target.value ? new Date(e.target.value) : null;
  refreshCurrentView();
});

document.getElementById('filter-clear-btn').addEventListener('click', () => {
  dateFrom = null;
  dateTo = null;
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value = '';
  document.getElementById('filter-row').style.display = 'none';
  document.getElementById('filter-toggle-btn').classList.remove('active');
  refreshCurrentView();
});

// ── Empty session toggle (button in header) ──
document.getElementById('empty-toggle-btn').addEventListener('click', () => {
  showEmpty = !showEmpty;
  localStorage.setItem('sd-showEmpty', showEmpty);
  refreshCurrentView();
  // Re-render sidebar badges to reflect toggle
  renderProjects();
  updateTotalBadge();
});

// ── Date filter toggle ──
document.getElementById('filter-toggle-btn').addEventListener('click', () => {
  const row = document.getElementById('filter-row');
  const btn = document.getElementById('filter-toggle-btn');
  const visible = row.style.display !== 'none';
  row.style.display = visible ? 'none' : 'flex';
  btn.classList.toggle('active', !visible);
});

function refreshCurrentView() {
  if (currentProjectId === '__all__') {
    renderAllSessions(applyEmptyFilter(applyDateFilter(currentSessions)));
  } else if (currentProjectId) {
    updateStatsBar(currentSessions);
    renderSessions(applyEmptyFilter(applyDateFilter(currentSessions)));
  }
}

function updateTotalBadge() {
  let total;
  if (!showEmpty) {
    // If any project has _nonEmptyCount computed, use it; otherwise fall back to sessionCount
    total = allProjects.reduce((s, p) => s + (p._nonEmptyCount != null ? p._nonEmptyCount : p.sessionCount), 0);
  } else {
    total = allProjects.reduce((s, p) => s + p.sessionCount, 0);
  }
  document.getElementById('total-sessions-badge').textContent = total;
}
function applyEmptyFilter(sessions) {
  if (showEmpty) return sessions;
  return sessions.filter(s => !s.isEmpty);
}

function updateStatsBar(sessions) {
  const emptyCount = sessions.filter(s => s.isEmpty).length;
  const visibleCount = showEmpty ? sessions.length : sessions.length - emptyCount;
  const totalMsgs = sessions.reduce((s, x) => s + x.messageCount, 0);

  let text = `${visibleCount} sessions · ${totalMsgs} total messages`;
  if (sessionsTotal > 0 && currentSessions.length < sessionsTotal) {
    text = `已加载 ${currentSessions.length}/${sessionsTotal} · ${totalMsgs} 条消息`;
  }
  if (emptyCount > 0) {
    text += ` · ${emptyCount} 空会话`;
  }
  document.getElementById('stats-text').textContent = text;

  // Update toggle button in header (already in HTML)
  const btn = document.getElementById('empty-toggle-btn');
  btn.textContent = showEmpty ? '隐藏空会话' : '显示空会话';
  btn.style.display = emptyCount > 0 ? '' : 'none';
}

// ── Error toast ──
function showError(msg) {
  let toast = document.getElementById('error-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'error-toast';
    toast.className = 'error-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = '⚠️ ' + msg;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

// ── Fetch wrapper with error handling ──
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Init ──
async function init() {
  currentProjectId = null;
  currentSessions = [];
  currentSessionId = null;
  lastSearchResults = null;
  lastSearchQueryText = '';
  try {
    const health = await apiFetch(`${API}/api/health`);
    const banner = document.getElementById('health-banner');
    if (!health.ok) {
      banner.textContent = '⚠️ 数据源异常：' + health.warnings.join('；') + '。Claude Code 可能更新了存储结构。';
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
    }
  } catch (err) {
    showError('无法连接服务端：' + err.message);
  }
  await loadProjects();
}

async function loadProjects() {
  try {
    allProjects = await apiFetch(`${API}/api/projects`);
  } catch (err) {
    showError('加载项目列表失败：' + err.message);
    allProjects = [];
  }

  document.getElementById('project-count').textContent = allProjects.length;
  const totalSessions = allProjects.reduce((s, p) => s + p.sessionCount, 0);
  document.getElementById('total-sessions-badge').textContent = totalSessions;

  renderProjects();

  // Reset middle and right panels on reload
  document.getElementById('sessions-header-text').textContent = 'ALL CLI';
  document.getElementById('sessions-list').textContent = '';
  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'sessions-empty';
  emptyDiv.textContent = 'Select a project from the left panel';
  document.getElementById('sessions-list').appendChild(emptyDiv);
  document.getElementById('stats-text').textContent = 'Select a project to view sessions';
  renderDetailEmpty();
}

function renderProjects() {
  const container = document.getElementById('projects-list');
  container.textContent = '';

  for (const proj of allProjects) {
    const empty = proj.sessionCount === 0;
    const div = document.createElement('div');
    div.className = 'project-item' + (currentProjectId === proj.id ? ' active' : '') + (empty ? ' empty' : '');
    div.dataset.projectId = proj.id;
    if (!empty) div.addEventListener('click', () => selectProject(proj.id));

    const nameDiv = document.createElement('div');
    nameDiv.className = 'project-name';
    nameDiv.textContent = proj.path;
    nameDiv.title = proj.path;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'project-meta';
    const count = (!showEmpty && proj._nonEmptyCount != null) ? proj._nonEmptyCount : proj.sessionCount;
    metaDiv.textContent = empty ? '0 sessions (cleared)' : `${count} sessions · ${timeAgo(proj.lastModified)}`;

    div.appendChild(nameDiv);
    div.appendChild(metaDiv);
    container.appendChild(div);
  }
}

// Update a single project's badge in the sidebar without full re-render
function updateProjectBadge(projectId) {
  const proj = allProjects.find(p => p.id === projectId);
  if (!proj) return;
  const div = document.querySelector(`.project-item[data-project-id="${projectId}"]`);
  if (!div) return;
  const metaDiv = div.querySelector('.project-meta');
  if (!metaDiv) return;
  const count = (!showEmpty && proj._nonEmptyCount != null) ? proj._nonEmptyCount : proj.sessionCount;
  metaDiv.textContent = `${count} sessions · ${timeAgo(proj.lastModified)}`;
}

async function selectProject(projectId) {
  currentProjectId = projectId;
  currentSessionId = null;

  // Reset search state
  searchInput.value = '';
  lastSearchQuery = '';
  lastSearchResults = null;
  lastSearchQueryText = '';
  isDeepSearch = false;
  deepSearchBtn.classList.remove('active');
  hideSearchStatus();

  // Update active states
  document.getElementById('all-sessions-btn').classList.remove('active');
  document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
  const items = document.querySelectorAll('.project-item');
  for (const item of items) {
    if (item.querySelector('.project-name')?.title === allProjects.find(p => p.id === projectId)?.path) {
      item.classList.add('active');
    }
  }

  // Load sessions
  const proj = allProjects.find(p => p.id === projectId);
  document.getElementById('sessions-header-text').textContent = proj ? proj.name.toUpperCase() : 'SESSIONS';

  const container = document.getElementById('sessions-list');
  container.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  const spinner = document.createElement('div');
  spinner.className = 'loading-spinner';
  loadingDiv.appendChild(spinner);
  loadingDiv.appendChild(document.createTextNode('Loading sessions...'));
  container.appendChild(loadingDiv);

  // Reset pagination
  sessionsTotal = 0;

  try {
    const result = await apiFetch(`${API}/api/projects/${projectId}/sessions?limit=${PAGE_SIZE}&offset=0`);
    if (Array.isArray(result)) {
      currentSessions = result;
      sessionsTotal = result.length;
    } else {
      currentSessions = result.sessions;
      sessionsTotal = result.total;
    }
  } catch (err) {
    showError('加载会话列表失败：' + err.message);
    currentSessions = [];
  }

  updateStatsBar(currentSessions);
  renderSessions(applyEmptyFilter(currentSessions));
  renderDetailEmpty();

  // Update project's non-empty count for sidebar badge
  if (proj) {
    proj._nonEmptyCount = currentSessions.filter(s => !s.isEmpty).length;
    updateProjectBadge(projectId);
    updateTotalBadge();
  }
}

// ── Pagination ──
async function loadMoreSessions() {
  if (isLoadingMore || !currentProjectId || currentProjectId === '__all__') return;
  isLoadingMore = true;
  const offset = currentSessions.length;
  try {
    const result = await apiFetch(`${API}/api/projects/${currentProjectId}/sessions?limit=${PAGE_SIZE}&offset=${offset}`);
    const newSessions = Array.isArray(result) ? result : result.sessions;
    sessionsTotal = result.total || newSessions.length;
    currentSessions = [...currentSessions, ...newSessions];
    updateStatsBar(currentSessions);
    renderSessions(applyEmptyFilter(currentSessions));
  } catch (err) {
    showError('加载更多失败：' + err.message);
  }
  isLoadingMore = false;
}

function renderSessions(sessions) {
  const container = document.getElementById('sessions-list');
  container.textContent = '';

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sessions-empty';
    empty.textContent = 'No sessions found';
    container.appendChild(empty);
    return;
  }

  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'session-item' + (currentSessionId === s.id ? ' active' : '');
    div._sessionId = s.id;
    div.addEventListener('click', (e) => {
      // Don't select session if clicking star button
      if (e.target.closest('.star-btn')) return;
      selectSession(s.id);
    });

    const titleDiv = document.createElement('div');
    titleDiv.className = 'session-title';
    const hash = document.createElement('span');
    hash.className = 'hash';
    hash.textContent = '#';
    titleDiv.appendChild(hash);
    titleDiv.appendChild(document.createTextNode(s.title));

    // Model tag
    if (s.models && s.models.length > 0) {
      const modelTag = document.createElement('span');
      modelTag.className = 'model-tag';
      modelTag.textContent = s.models.length === 1 ? s.models[0] : s.models[0] + ` +${s.models.length - 1}`;
    }

    // Star button
    const starBtn = document.createElement('span');
    starBtn.className = 'star-btn' + (isFavorite(s.id) ? ' active' : '');
    starBtn.textContent = isFavorite(s.id) ? '★' : '☆';
    starBtn.title = isFavorite(s.id) ? '取消收藏' : '收藏';
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(s.id);
    });
    titleDiv.appendChild(starBtn);

    const pathDiv = document.createElement('div');
    pathDiv.className = 'session-path';
    pathDiv.textContent = s.id;

    const footerDiv = document.createElement('div');
    footerDiv.className = 'session-footer';
    const countSpan = document.createElement('span');
    countSpan.className = 'msg-count';
    countSpan.textContent = `${s.messageCount} messages`;
    const timeSpan = document.createElement('span');
    timeSpan.textContent = timeAgo(s.lastModified);
    footerDiv.appendChild(countSpan);
    if (s.models && s.models.length > 0) {
      const modelTag = document.createElement('span');
      modelTag.className = 'model-tag';
      modelTag.textContent = s.models.length === 1 ? s.models[0] : s.models[0] + ` +${s.models.length - 1}`;
      footerDiv.appendChild(modelTag);
    }
    footerDiv.appendChild(timeSpan);

    div.appendChild(titleDiv);
    div.appendChild(pathDiv);
    div.appendChild(footerDiv);
    container.appendChild(div);
  }

  // Load more button
  if (sessionsTotal > 0 && currentSessions.length < sessionsTotal) {
    const moreDiv = document.createElement('div');
    moreDiv.className = 'load-more';
    const remaining = sessionsTotal - currentSessions.length;
    moreDiv.textContent = `加载更多（剩余 ${remaining} 条）`;
    moreDiv.addEventListener('click', loadMoreSessions);
    container.appendChild(moreDiv);
  }
}

async function selectSession(sessionId) {
  currentSessionId = sessionId;

  // Update active highlight without re-rendering the list
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el._sessionId === sessionId);
  });

  const panel = document.getElementById('detail-panel');
  panel.textContent = '';

  // Loading
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  const spinner = document.createElement('div');
  spinner.className = 'loading-spinner';
  loadingDiv.appendChild(spinner);
  loadingDiv.appendChild(document.createTextNode('Loading messages...'));
  panel.appendChild(loadingDiv);

  try {
    const res = await apiFetch(`${API}/api/projects/${currentProjectId}/sessions/${sessionId}`);
    const session = currentSessions.find(s => s.id === sessionId);
    renderDetail(session, res);
  } catch (err) {
    showError('加载会话详情失败：' + err.message);
    renderDetailEmpty();
  }
}

function renderDetail(session, messages) {
  const panel = document.getElementById('detail-panel');
  panel.textContent = '';

  // Header
  const header = document.createElement('div');
  header.className = 'detail-header';

  const closeBtn = document.createElement('span');
  closeBtn.className = 'detail-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    currentSessionId = null;
    // Just remove active highlight, don't re-render the list
    document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
    renderDetailEmpty();
  });

  const titleSpan = document.createElement('span');
  titleSpan.className = 'detail-title-text';
  titleSpan.textContent = 'Session Details';

  const metaSpan = document.createElement('span');
  metaSpan.className = 'detail-meta';
  const proj = allProjects.find(p => p.id === currentProjectId);
  const fullPath = proj ? `${currentSourcePath}/${proj.id}/${session?.id}.jsonl` : '';
  metaSpan.textContent = [
    fullPath,
    `${messages.length} messages`,
    session?.startTime ? formatDate(session.startTime) : '',
  ].filter(Boolean).join(' · ');

  // Export button
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-btn';
  exportBtn.textContent = '📥 导出 Markdown';
  exportBtn.title = '导出当前会话为 Markdown 文件';
  exportBtn.addEventListener('click', () => exportSession(session.id));

  header.appendChild(closeBtn);
  header.appendChild(titleSpan);
  header.appendChild(metaSpan);
  header.appendChild(exportBtn);
  panel.appendChild(header);

  // Messages
  const container = document.createElement('div');
  container.id = 'messages-container';

  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;

    const roleDiv = document.createElement('div');
    roleDiv.className = 'message-role';
    roleDiv.textContent = msg.role === 'user' ? '● USER' : '● ASSISTANT';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (msg.role === 'assistant' && msg.parts) {
      contentDiv.appendChild(buildAssistantContent(msg.parts));
    } else {
      contentDiv.textContent = cleanContent(msg.content || '');
    }

    div.appendChild(roleDiv);
    div.appendChild(contentDiv);

    if (msg.timestamp) {
      const timeDiv = document.createElement('div');
      timeDiv.className = 'message-time';
      timeDiv.textContent = formatDate(msg.timestamp);
      div.appendChild(timeDiv);
    }

    container.appendChild(div);
  }

  panel.appendChild(container);
}

function buildAssistantContent(parts) {
  const frag = document.createDocumentFragment();

  for (const p of parts) {
    if (p.type === 'text') {
      const textNode = document.createElement('div');
      textNode.appendChild(renderFormattedText(p.text));
      frag.appendChild(textNode);
    } else if (p.type === 'tool_use') {
      const meta = getToolMeta(p.name);
      const block = document.createElement('div');
      block.className = `tool-block cat-${meta.cat}`;

      const header = document.createElement('div');
      header.className = 'tool-header';
      header.addEventListener('click', () => block.classList.toggle('open'));

      const chevron = document.createElement('span');
      chevron.className = 'tool-chevron';
      chevron.textContent = '▶';

      const icon = document.createElement('span');
      icon.className = 'tool-icon';
      icon.textContent = meta.icon;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tool-name';
      nameSpan.textContent = p.name;

      const summary = document.createElement('span');
      summary.className = 'tool-summary';
      summary.textContent = toolSummaryText(p.name, p.input);

      header.appendChild(chevron);
      header.appendChild(icon);
      header.appendChild(nameSpan);
      header.appendChild(summary);
      block.appendChild(header);

      if (p.input) {
        const body = document.createElement('div');
        body.className = 'tool-body';
        const inputDiv = document.createElement('div');
        inputDiv.className = 'tool-input';
        inputDiv.textContent = typeof p.input === 'string' ? p.input : JSON.stringify(p.input, null, 2);
        body.appendChild(inputDiv);
        block.appendChild(body);
      }

      frag.appendChild(block);
    }
  }

  return frag;
}

// Render text with basic formatting: code blocks and inline code
function renderFormattedText(text) {
  const frag = document.createDocumentFragment();
  const codeBlockRe = /```([\w]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      frag.appendChild(renderInlineText(text.slice(lastIndex, match.index)));
    }
    const lang = match[1] || '';
    const code = match[2].replace(/\n$/, '');

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');

    if (lang) {
      codeEl.className = `language-${lang}`;
    }

    codeEl.textContent = code;
    pre.appendChild(codeEl);

    // Apply syntax highlighting if hljs is available
    if (typeof hljs !== 'undefined') {
      try {
        if (lang && hljs.getLanguage(lang)) {
          codeEl.innerHTML = hljs.highlight(code, { language: lang }).value;
        } else {
          codeEl.innerHTML = hljs.highlightAuto(code).value;
        }
      } catch (e) {
        // If highlighting fails, keep plain text
        console.warn('Syntax highlighting failed:', e);
      }
    }

    frag.appendChild(pre);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    frag.appendChild(renderInlineText(text.slice(lastIndex)));
  }

  return frag;
}

// Render inline text with `backtick` code spans
function renderInlineText(text) {
  const frag = document.createDocumentFragment();
  const inlineRe = /`([^`\n]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const span = document.createElement('span');
      span.textContent = text.slice(lastIndex, match.index);
      frag.appendChild(span);
    }
    const code = document.createElement('code');
    code.className = 'msg-inline-code';
    code.textContent = match[1];
    frag.appendChild(code);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const span = document.createElement('span');
    span.textContent = text.slice(lastIndex);
    frag.appendChild(span);
  }

  return frag;
}

function renderDetailEmpty() {
  const panel = document.getElementById('detail-panel');
  panel.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'detail-empty';
  empty.textContent = 'Select a session to view its messages';
  panel.appendChild(empty);
}

// ── Search ──
let searchDebounceTimer = null;
let isDeepSearch = false;
let isSearching = false;
let lastSearchQuery = '';

const searchInput = document.getElementById('search-input');
const deepSearchBtn = document.getElementById('deep-search-btn');
const searchStatus = document.getElementById('search-status');

// Debounced search on input
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  const q = searchInput.value.trim();

  // Empty query: revert to normal session list
  if (!q) {
    lastSearchQuery = '';
    hideSearchStatus();
    renderSessions(currentSessions);
    return;
  }

  searchDebounceTimer = setTimeout(() => performSearch(q, false), 300);
});

// Deep search button
deepSearchBtn.addEventListener('click', () => {
  const q = searchInput.value.trim();
  if (!q) return;
  isDeepSearch = true;
  deepSearchBtn.classList.add('active');
  performSearch(q, true);
});

async function performSearch(query, deep) {
  // No project selected or in "all" mode: fall back to local filter
  if (!currentProjectId || currentProjectId === '__all__') {
    const filtered = getFilteredSessionsLocal(query);
    renderSessions(filtered);
    return;
  }

  if (isSearching) return;
  isSearching = true;
  lastSearchQuery = query;

  showSearchStatus(deep ? '🔍 深度搜索中…' : '🔍 搜索中…');

  try {
    const data = await apiFetch(
      `${API}/api/projects/${currentProjectId}/search?q=${encodeURIComponent(query)}&deep=${deep ? '1' : '0'}`
    );

    // User may have typed something else while we were fetching
    if (searchInput.value.trim() !== query && !deep) {
      isSearching = false;
      return;
    }

    if (data.results.length === 0) {
      showSearchStatus(`无结果 · 已扫描 ${data.scanned}/${data.total} 个会话${!deep ? ' · 点击「深度」搜索全部' : ''}`);
      renderSessions([]);
    } else {
      showSearchStatus(
        `${data.results.length} 条结果 · 扫描 ${data.scanned}/${data.total} 个会话` +
        (!deep && data.scanned < data.total ? ' · 点击「深度」搜索全部' : '')
      );
      renderSearchResults(data.results, query);
    }
  } catch (err) {
    showError('搜索失败：' + err.message);
    hideSearchStatus();
  }

  isSearching = false;
  if (!deep) {
    isDeepSearch = false;
    deepSearchBtn.classList.remove('active');
  }
}

function renderSearchResults(results, query) {
  const container = document.getElementById('sessions-list');
  container.textContent = '';

  for (const r of results) {
    // Try to find full session info from currentSessions
    const sessionInfo = currentSessions.find(s => s.id === r.sessionId);

    const div = document.createElement('div');
    div.className = 'session-item';
    div._sessionId = r.sessionId;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.star-btn')) return;
      currentSessionId = r.sessionId;
      selectSession(r.sessionId);
    });

    const titleDiv = document.createElement('div');
    titleDiv.className = 'session-title';
    const hash = document.createElement('span');
    hash.className = 'hash';
    hash.textContent = '#';
    titleDiv.appendChild(hash);
    titleDiv.appendChild(document.createTextNode(
      sessionInfo ? sessionInfo.title : r.sessionId.slice(0, 8)
    ));

    // Star button
    const starBtn = document.createElement('span');
    starBtn.className = 'star-btn' + (isFavorite(r.sessionId) ? ' active' : '');
    starBtn.textContent = isFavorite(r.sessionId) ? '★' : '☆';
    starBtn.title = isFavorite(r.sessionId) ? '取消收藏' : '收藏';
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(r.sessionId);
    });
    titleDiv.appendChild(starBtn);

    div.appendChild(titleDiv);

    // Snippet with highlighted match
    if (r.snippet) {
      const snippetDiv = document.createElement('div');
      snippetDiv.className = 'session-snippet';
      highlightSnippet(snippetDiv, r.snippet, query);
      div.appendChild(snippetDiv);
    }

    const footerDiv = document.createElement('div');
    footerDiv.className = 'session-footer';
    const countSpan = document.createElement('span');
    countSpan.className = 'msg-count';
    countSpan.textContent = sessionInfo ? `${sessionInfo.messageCount} messages` : '';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = timeAgo(r.lastModified);
    footerDiv.appendChild(countSpan);
    footerDiv.appendChild(timeSpan);

    div.appendChild(footerDiv);
    container.appendChild(div);
  }
}

function highlightSnippet(el, snippet, query) {
  const lowerSnippet = snippet.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerSnippet.indexOf(lowerQuery);

  if (idx === -1) {
    el.textContent = snippet;
    return;
  }

  const before = snippet.slice(0, idx);
  const match = snippet.slice(idx, idx + query.length);
  const after = snippet.slice(idx + query.length);

  if (before) el.appendChild(document.createTextNode(before));
  const mark = document.createElement('mark');
  mark.textContent = match;
  el.appendChild(mark);
  if (after) el.appendChild(document.createTextNode(after));
}

function showSearchStatus(text) {
  searchStatus.textContent = text;
  searchStatus.classList.add('visible');
}

function hideSearchStatus() {
  searchStatus.classList.remove('visible');
}

// Local filter fallback (for "all sessions" mode or when no project selected)
function getFilteredSessionsLocal(query) {
  const q = (query || '').toLowerCase();
  if (!q) return currentSessions;
  return currentSessions.filter(s =>
    (s.title || '').toLowerCase().includes(q) ||
    (s.firstUserMessage || '').toLowerCase().includes(q) ||
    (s.id || '').toLowerCase().includes(q)
  );
}

function getFilteredSessions(query) {
  const q = query || searchInput.value.trim();
  if (!q) return currentSessions;
  // If we have search results showing, don't re-filter
  if (lastSearchQuery && currentProjectId && currentProjectId !== '__all__') {
    return currentSessions;
  }
  return getFilteredSessionsLocal(q);
}

// ── All CLI (concurrent fetch) ──
document.getElementById('all-sessions-btn').addEventListener('click', async () => {
  currentProjectId = null;
  currentSessionId = null;
  document.getElementById('all-sessions-btn').classList.add('active');
  document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
  document.getElementById('sessions-header-text').textContent = 'ALL CLI';

  const container = document.getElementById('sessions-list');
  container.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'loading';
  const spinner = document.createElement('div');
  spinner.className = 'loading-spinner';
  loadingDiv.appendChild(spinner);
  loadingDiv.appendChild(document.createTextNode('Loading all sessions...'));
  container.appendChild(loadingDiv);

  // Concurrent fetch all projects' sessions
  const results = await Promise.allSettled(
    allProjects.map(async (proj) => {
      const sessions = await apiFetch(`${API}/api/projects/${proj.id}/sessions`);
      return sessions.map(s => ({ ...s, _projectId: proj.id, _projectPath: proj.path }));
    })
  );

  let allSessions = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allSessions = allSessions.concat(r.value);
    }
  }

  allSessions.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
  currentSessions = allSessions;
  currentProjectId = '__all__';

  // Update all projects' non-empty counts from fetched data
  for (const proj of allProjects) {
    const projSessions = allSessions.filter(s => s._projectId === proj.id);
    proj._nonEmptyCount = projSessions.filter(s => !s.isEmpty).length;
  }
  renderProjects();
  updateTotalBadge();

  updateStatsBar(allSessions);
  renderAllSessions(applyEmptyFilter(allSessions));
  renderDetailEmpty();
});

function renderAllSessions(sessions) {
  const container = document.getElementById('sessions-list');
  container.textContent = '';

  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'session-item';
    div._sessionId = s.id;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.star-btn')) return;
      currentProjectId = s._projectId;
      currentSessionId = s.id;
      selectSession(s.id);
    });

    const titleDiv = document.createElement('div');
    titleDiv.className = 'session-title';
    const hash = document.createElement('span');
    hash.className = 'hash';
    hash.textContent = '#';
    titleDiv.appendChild(hash);
    titleDiv.appendChild(document.createTextNode(s.title));

    // Model tag
    if (s.models && s.models.length > 0) {
      const modelTag = document.createElement('span');
      modelTag.className = 'model-tag';
      modelTag.textContent = s.models.length === 1 ? s.models[0] : s.models[0] + ` +${s.models.length - 1}`;
    }

    // Star button
    const starBtn = document.createElement('span');
    starBtn.className = 'star-btn' + (isFavorite(s.id) ? ' active' : '');
    starBtn.textContent = isFavorite(s.id) ? '★' : '☆';
    starBtn.title = isFavorite(s.id) ? '取消收藏' : '收藏';
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(s.id);
    });
    titleDiv.appendChild(starBtn);

    const pathDiv = document.createElement('div');
    pathDiv.className = 'session-path';
    pathDiv.textContent = s.id;

    const footerDiv = document.createElement('div');
    footerDiv.className = 'session-footer';
    const countSpan = document.createElement('span');
    countSpan.className = 'msg-count';
    countSpan.textContent = `${s.messageCount} messages`;
    const timeSpan = document.createElement('span');
    timeSpan.textContent = timeAgo(s.lastModified);
    footerDiv.appendChild(countSpan);
    if (s.models && s.models.length > 0) {
      const modelTag = document.createElement('span');
      modelTag.className = 'model-tag';
      modelTag.textContent = s.models.length === 1 ? s.models[0] : s.models[0] + ` +${s.models.length - 1}`;
      footerDiv.appendChild(modelTag);
    }
    footerDiv.appendChild(timeSpan);

    div.appendChild(titleDiv);
    div.appendChild(pathDiv);
    div.appendChild(footerDiv);
    container.appendChild(div);
  }
}

// ── Refresh ──
document.getElementById('refresh-btn').addEventListener('click', async () => {
  await fetch(`${API}/api/clear-cache`, { method: 'POST' }).catch(() => {});
  init();
});

// ── Backup ──
document.getElementById('backup-btn').addEventListener('click', async () => {
  const btn = document.getElementById('backup-btn');
  const proj = currentProjectId && currentProjectId !== '__all__'
    ? allProjects.find(p => p.id === currentProjectId)
    : null;

  const label = proj ? proj.name : '全部项目';
  if (!confirm(`备份「${label}」的会话数据？\n保存到 ~/Personal/session-backups/`)) return;

  btn.disabled = true;
  btn.textContent = '💾 备份中...';
  try {
    const res = await fetch(`${API}/api/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proj ? { projectId: currentProjectId } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    let toast = document.getElementById('success-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'success-toast';
      toast.className = 'success-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = `✅ 备份完成 (${data.size})`;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3000);
  } catch (err) {
    showError('备份失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Backup';
  }
});

// ── Utilities ──
function cleanContent(text) {
  return text.replace(/<[^>]+>/g, '').trim();
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Theme toggle ──
const themeBtn = document.getElementById('theme-toggle');
function applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  localStorage.setItem('sd-theme', theme);
}
themeBtn.addEventListener('click', () => {
  const isLight = document.documentElement.classList.contains('light');
  applyTheme(isLight ? 'dark' : 'light');
});
// Restore saved preference
applyTheme(localStorage.getItem('sd-theme') || 'dark');

// ── Find in detail panel (Cmd+F / Ctrl+F) ──
let findMatches = [];
let findCurrentIdx = -1;

// Intercept Cmd+F when detail panel has content
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    const container = document.getElementById('messages-container');
    if (!container) return; // no session open
    e.preventDefault();
    openFindBar();
  }
  if (e.key === 'Escape') {
    closeFindBar();
  }
});

function openFindBar() {
  let bar = document.getElementById('find-bar');
  if (!bar) {
    bar = createFindBar();
  }
  bar.classList.add('visible');
  const input = bar.querySelector('input');
  input.focus();
  input.select();
}

function closeFindBar() {
  const bar = document.getElementById('find-bar');
  if (!bar) return;
  bar.classList.remove('visible');
  clearFindHighlights();
  findMatches = [];
  findCurrentIdx = -1;
}

function createFindBar() {
  const bar = document.createElement('div');
  bar.id = 'find-bar';
  bar.className = 'find-bar';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '在会话中搜索…';

  const info = document.createElement('span');
  info.className = 'find-bar-info';
  info.id = 'find-bar-info';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'find-bar-btn';
  prevBtn.textContent = '▲';
  prevBtn.title = '上一个';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'find-bar-btn';
  nextBtn.textContent = '▼';
  nextBtn.title = '下一个';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'find-bar-btn';
  closeBtn.textContent = '✕';
  closeBtn.title = '关闭';

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runFind(input.value.trim()), 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.shiftKey ? findPrev() : findNext();
    }
    if (e.key === 'Escape') {
      closeFindBar();
    }
  });
  prevBtn.addEventListener('click', findPrev);
  nextBtn.addEventListener('click', findNext);
  closeBtn.addEventListener('click', closeFindBar);

  bar.appendChild(input);
  bar.appendChild(info);
  bar.appendChild(prevBtn);
  bar.appendChild(nextBtn);
  bar.appendChild(closeBtn);

  // Insert after detail-header
  const panel = document.getElementById('detail-panel');
  const header = panel.querySelector('.detail-header');
  if (header) {
    header.after(bar);
  } else {
    panel.prepend(bar);
  }

  return bar;
}

function runFind(query) {
  clearFindHighlights();
  findMatches = [];
  findCurrentIdx = -1;

  const infoEl = document.getElementById('find-bar-info');
  if (!query) {
    if (infoEl) infoEl.textContent = '';
    return;
  }

  const container = document.getElementById('messages-container');
  if (!container) return;

  // Walk all text nodes inside message-content elements
  const contentEls = container.querySelectorAll('.message-content');
  const lowerQuery = query.toLowerCase();

  for (const el of contentEls) {
    highlightTextNodes(el, query, lowerQuery);
  }

  findMatches = container.querySelectorAll('.find-highlight');
  if (infoEl) {
    infoEl.textContent = findMatches.length > 0 ? `0/${findMatches.length}` : '无结果';
  }

  if (findMatches.length > 0) {
    findCurrentIdx = 0;
    scrollToMatch(0);
  }
}

function highlightTextNodes(el, query, lowerQuery) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodesToProcess = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue.toLowerCase().includes(lowerQuery)) {
      nodesToProcess.push(node);
    }
  }

  for (const node of nodesToProcess) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    let pos = lower.indexOf(lowerQuery);

    while (pos !== -1) {
      if (pos > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, pos)));
      }
      const mark = document.createElement('mark');
      mark.className = 'find-highlight';
      mark.textContent = text.slice(pos, pos + query.length);
      frag.appendChild(mark);
      lastIdx = pos + query.length;
      pos = lower.indexOf(lowerQuery, lastIdx);
    }

    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }

    node.parentNode.replaceChild(frag, node);
  }
}

function clearFindHighlights() {
  const marks = document.querySelectorAll('.find-highlight');
  for (const mark of marks) {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize(); // merge adjacent text nodes
  }
}

function findNext() {
  if (findMatches.length === 0) return;
  findCurrentIdx = (findCurrentIdx + 1) % findMatches.length;
  scrollToMatch(findCurrentIdx);
}

function findPrev() {
  if (findMatches.length === 0) return;
  findCurrentIdx = (findCurrentIdx - 1 + findMatches.length) % findMatches.length;
  scrollToMatch(findCurrentIdx);
}

function scrollToMatch(idx) {
  // Remove current highlight from all
  for (const m of findMatches) m.classList.remove('current');

  const match = findMatches[idx];
  if (!match) return;
  match.classList.add('current');
  match.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const infoEl = document.getElementById('find-bar-info');
  if (infoEl) infoEl.textContent = `${idx + 1}/${findMatches.length}`;
}

// ── Export session as Markdown ──
async function exportSession(sessionId) {
  try {
    const url = `${API}/api/projects/${currentProjectId}/sessions/${sessionId}/export`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${sessionId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);

    // Show success toast
    let toast = document.getElementById('success-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'success-toast';
      toast.className = 'success-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = '✅ 导出成功';
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2000);
  } catch (err) {
    showError('导出失败：' + err.message);
  }
}

// ── Resizable panels ──
function initResize(handleId, panelId) {
  const handle = document.getElementById(handleId);
  const panel = document.getElementById(panelId);
  if (!handle || !panel) return;

  let startX, startW;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add('active');
    const onMove = (e) => {
      panel.style.width = Math.max(120, startW + e.clientX - startX) + 'px';
    };
    const onUp = () => {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
initResize('resize-handle-1', 'projects-panel');
initResize('resize-handle-2', 'sessions-panel');

// ── Data source toggle ──
document.getElementById('source-toggle').addEventListener('click', async (e) => {
  const btn = e.target.closest('.source-btn');
  if (!btn) return;
  const source = btn.dataset.source;
  try {
    const res = await fetch(`${API}/api/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    const data = await res.json();
    currentSourcePath = data.path.replace(/^\/Users\/[^/]+/, '~');
    document.querySelectorAll('.source-btn').forEach(b => b.classList.toggle('active', b === btn));
    init();
  } catch (err) {
    showError('切换数据源失败：' + err.message);
  }
});

// ── Start ──
init();
