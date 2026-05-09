# Claude Session Dashboard

Claude Code 的图形化会话浏览器。

## 解决什么问题

- 这个 Dashboard 直接读取 CC 的本地存储（`~/.claude/projects/`），提供按项目浏览、全文搜索、日期筛选、空会话过滤等功能。

## 核心功能

- **项目树形浏览**：左侧栏列出所有项目，点击加载该项目全部会话
- **全文搜索**：快速搜索（最近 50 个）/ 搜全部（所有会话）
- **日期筛选**：按时间范围过滤
- **空会话过滤**：隐藏仅含 `/clear`、`/help` 等内部命令的会话
- **分页加载**：默认加载 50 条，底部"加载更多"逐步追加，大项目秒开
- **模型标签**：每条会话显示所用的模型名称（`claude-sonnet-4-6`、`deepseek-v4-flash` 等），多模型切换会标记 `+N`
- **导出 Markdown**：单个会话导出为 `.md`
- **收藏会话**：标记常用会话，方便快速跳转
- **深浅主题切换**：护眼

## 快速开始

```bash
git clone https://github.com/cyontheway/claude-session-dashboard.git
cd claude-session-dashboard
npm install
npm start
# 浏览器打开 http://localhost:3456
```

> 💡 **快捷启动**：建议在 shell 配置文件（`~/.zshrc`、`~/.bashrc` 等）加个 alias 或函数，一键启动：
> ```bash
> dashboard() {
>   cd ~/path/to/session-dashboard-dist && node server.js &
>   open http://localhost:3456  # 其他系统换成 xdg-open（Linux）或 start（Windows）
> }
> ```

## 高级配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | `3456` | 服务端口 |
| `BACKUP_DIR` | 无 | 可选。启用后可切换查看备份数据 |
| `BACKUP_DEST` | `~/claude-session-backups/` | 备份功能的目标目录 |

### BACKUP_DIR 使用场景

如果你有自己的备份脚本，定期把 `~/.claude/projects/` 复制到另一个目录（如 `~/backup/claude/`），设置这个变量后 Dashboard 会在左下角显示 **Live / Backup** 切换按钮。

```bash
# 启动时指向备份目录
BACKUP_DIR=~/backup/claude/projects npm start
```

**注意**：备份路径需保留 CC 的原始目录结构（`{项目编码目录}/{sessionId}.jsonl`）。

### BACKUP_DEST 使用场景

Dashboard 左下角的 **Backup** 按钮会将会话数据复制到指定目录，方便本地归档。默认保存到 `~/claude-session-backups/`，可通过环境变量自定义：

```bash
# 自定义备份路径
BACKUP_DEST=~/my-claude-backups npm start
```

## 数据来源

- **读取位置**：`~/.claude/projects/` 下的 JSONL 会话文件（CC 自动生成）
- **访问方式**：仅本机（`127.0.0.1`），只读，不修改任何数据

## 要求

- Node.js >= 18
- Claude Code（会话数据在 `~/.claude/projects/`）

## License

MIT License. 详见 [LICENSE](./LICENSE) 和 [THIRD-PARTY-LICENSES](./THIRD-PARTY-LICENSES)。
