# Session Dashboard

可视化浏览 AI 编码助手会话历史的本地面板。

## 功能

- **多数据源**：同时浏览 Claude Code、PI Agent 的会话历史
- **全文搜索**：支持会话内容关键词检索（快速 / 深度两种模式）
- **日期筛选**：按时间范围过滤会话
- **空会话过滤**：隐藏仅含内部命令的会话
- **会话导出**：导出为 Markdown 文件
- **收藏会话**：星标标记常用会话
- **主题切换**：深色/浅色
- **分页加载**：大数据量时渐进加载

## 快速开始

```bash
cd session-dashboard
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

| 来源 | 路径 | 说明 |
|------|------|------|
| **Claude Code** | `~/.claude/projects/` | CLI 会话，自动生成 |
| **PI** | `~/.pi/agent/sessions/` | PI Agent 会话 |

仅本机访问（绑定 127.0.0.1），只读操作，不修改任何会话数据。

## 要求

- Node.js >= 18
- Claude Code 或 PI Agent（至少一个数据源存在）
