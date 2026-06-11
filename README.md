# Claude Session Dashboard

可视化浏览 Claude Code 会话历史的本地面板。

## 功能

- 按项目浏览所有 Claude Code 会话
- 全文搜索（快速搜索最近 50 个 / 深度搜索全部）
- 日期筛选
- 空会话过滤（隐藏仅含 CLI 内部命令的会话）
- 会话导出为 Markdown
- 收藏会话
- 深色/浅色主题切换
- 搜索缓存管理（Refresh 按钮释放内存）

## 快速开始

```bash
cd claude-session-dashboard
npm install
npm start
# 浏览器打开 http://localhost:3456
```

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `3456` | 服务端口 |
| `BACKUP_DIR` | 无 | 备份数据源路径（可选） |

示例：

```bash
# 自定义端口
PORT=8080 npm start

# 启用备份数据源切换
BACKUP_DIR=~/my-backup/claude-projects npm start
```

## 数据来源

读取 `~/.claude/projects/` 下的 JSONL 会话文件（Claude Code 自动生成）。

仅本机访问（绑定 127.0.0.1），只读操作，不修改任何会话数据。

## 要求

- Node.js >= 18
- Claude Code（会话数据在 `~/.claude/projects/`）
