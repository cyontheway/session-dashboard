# Changelog

> CLI + PI 发布版。完整增强版（含 Cowork）见 `session-dashboard/`。

## 3.3.1 (2026-07-04)

- **PI 会话详情路径修复**：detail header 中 PI 会话文件路径使用实际目录名（`proj.id`）而非解码显示名（`proj.name`），修复路径与文件系统不一致的问题

## 3.3.0 (2026-06-11)

- **PI Agent 会话支持**：读取 `~/.pi/agent/sessions/`，左栏 PI 面板按项目分组，含列表/详情/导出/全文搜索
- **搜索重构**：统一 `renderSearchResults`，PI / ALL CLI / 单项目搜索共用同一渲染函数
- **全文搜索增强**：ALL Sessions 模式搜索遍历所有项目调用搜索 API，支持会话内容关键词搜索
- **undefined 修复**：`currentSessions.find` 未命中时兜底为 session ID，避免详情头显示 `undefined.jsonl`
- **导出健壮性**：session 对象为空时改用 `currentSessionId`，防止崩溃
- **命名统一**：左栏按钮和中间栏 header 改为「Claude Code」「PI」

## 3.2.0 (2026-05-02)

- **命名**："All Sessions" → "All CLI"
- **紧凑布局**：边栏、会话列表、详情面板全部缩小 padding 和字号
- **按钮并排**：刷新和备份按钮横向排列
- **同步 v4 改动**：`public.v4/` 的布局和文本更新同步到发布版

## 3.1.0 (2026-04-26)

- **分页加载**：后端 `?limit=N&offset=N`，先 stat 排序再扫描可见切片；前端默认 50 条，"加载更多"逐步追加
- **模型标签**：每条会话显示模型名，多模型切换标记 `+N`
- **备份功能**：`BACKUP_DEST` 环境变量可配置备份路径
- **环境变量**：`BACKUP_DIR` 替代硬编码备份目录
- **清理**：移除所有本机硬编码路径，准备发布 GitHub

## 3.0.0 (2026-02-28)

- **数据源切换**：页面内 Live/Backup 一键切换（Live=`~/.claude/projects/`，Backup 由 `BACKUP_DIR` 指定）
- **全量历史**：Backup 源包含全量会话（含被 CC 清理的文件）
- **空项目**：不再隐藏，改为标灰显示 `0 sessions (cleared)`
- **修复**：切换数据源后中间栏/右栏未重置的 bug
- **路径跟随**：Session Details 路径跟随当前数据源，不再硬编码

## 2.2.0 (2026-02-24)

- **新格式适配**：适配 CC 新版 session 存储结构（`uuid/subagents/*.jsonl` 目录格式）
- **自动过滤**：过滤 warmup 预热会话和 subagent 子代理记录
- **面板拖拽**：三栏可拖拽调节宽度
- **一键备份**：支持备份全部或单个项目

## 2.1.0 (2026-02-17)

- **搜索增强**：后端同时匹配 session ID 和会话内容文本
- **智能展示**：匹配 ID 时显示 `Session ID: xxx`，匹配内容时显示文本片段
- **UUID 片段搜索**：输入部分 session ID 即可快速定位

## 2.0.0 (2026-02-16)

- **架构优化**：单文件 HTML → `index.html` + `style.css` + `app.js`，浏览器可分别缓存
- **安全防护**：路径遍历防护（`safePath` 校验）、同步 I/O 全面异步化
- **All Sessions 并发**：串行 → `Promise.allSettled` 并发请求
- **全文搜索**：快速模式扫最近 50 个 + 深度模式扫全项目
- **会话内查找**：Cmd+F 唤起搜索条
- **错误处理**：统一 `apiFetch` 封装 + toast 提示

## 1.0.0 (2026-02-15)

- 三栏布局 + 工具分类 + 主题切换，单文件 HTML 原型
