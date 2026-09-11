# Hermes Provider Switcher

面向 Hermes、Claude Code/Desktop、Codex、Gemini CLI、Grok Build、OpenCode 和 OpenClaw 的本地配置工作台。项目在保留 CCS 配置管理能力的基础上，使用 Tauri 2 + Rust 原生核心，重点减少启动阶段工作，并将常用操作集中到单页工作台。

## 已实现能力

- 多平台供应商、模型与自定义 API 配置
- 平台配置写入、当前供应商切换、备份与恢复
- Hermes `config.yaml` 的供应商/模型映射和 MCP 往返保留
- 本地路由、故障转移、请求修正器、用量统计
- MCP、Skills、提示词、项目 Profile、会话和工作区管理
- Claude Code/Desktop、Codex、Gemini、Grok Build、OpenCode、OpenClaw、Hermes 的独立配置入口
- OAuth/额度查询、工具版本检测、安装命令、冲突诊断
- WebDAV/S3 同步、SQL 导入导出、深链接导入
- 中文界面、浅色默认主题、跟随系统主题、键盘焦点和减少动效支持
- 设置页中的应用目录、日志、路由、高级选项、备份和关于信息

## 与旧版本的区别

| 项目 | 旧版 | 重置版 |
| --- | --- | --- |
| 应用壳 | Electron 31 | Tauri 2 + Rust |
| 启动阶段 | 可能同时触发版本/工具检查 | 不在启动时联网或扫描工具，进入设置后按需检查 |
| 数据目录 | `.hermes-provider-switcher` | 默认 `.hermes-provider-switcher-reset` |
| 更新检查 | 依赖旧更新流程 | 限时读取本项目 GitHub Release 元数据，下载从发布页手动完成 |
| YAML 运行时 | js-yaml | Rust YAML 解析；输入审计与大小限制持续完善 |
| UI | 页面跳转较多 | 紧凑工作台导航，供应商、资源和设置可直接切换 |

参考项目：[CC Switch](https://github.com/farion1231/cc-switch)。本项目仅借鉴其公开的配置管理思路和功能组织，品牌、发布签名和上游推广内容不作为本项目发布信息。


## 开发

```powershell
cd D:\AI\智能体工作目录\claude工作目录\Hermes第三方模型工具\hermes-provider-switcher-reset-ccs-core
pnpm install
pnpm run typecheck
pnpm run test:unit
pnpm run build:renderer
pnpm run build
```

首次构建 Tauri 桌面包需要本机 Windows SDK、WebView2 和 Rust 构建环境。构建产物在 `src-tauri\target\release\bundle\`。

## 数据位置

默认应用数据目录为 `%USERPROFILE%\.hermes-provider-switcher-reset`。如需将数据放到 D 盘，可在启动前设置：

```powershell
$env:HERMES_PROVIDER_SWITCHER_DATA_DIR='D:\HermesProviderSwitcher\data'
pnpm run dev
```

便携版在可执行文件旁放置 `portable.ini` 后，会把应用数据库、日志、备份及 Windows WebView2 数据放到便携目录内。旧版目录和 CCS 目录不会自动合并。

## 更新检查说明

“检查更新”只读取 GitHub Release 元数据，并设置明确的网络超时；发现新版本后打开发布页。未配置发布签名时不执行静默下载或自动安装，避免出现界面卡住、半安装或签名不匹配。

## 安全与数据

- API Key 仅用于写入用户选择的平台配置；日志展示会脱敏。
- 配置写入前保留备份。
- 不会自动上传源代码、配置文件、日志或凭据。
- 邮件中的第三方扫描链接不属于本项目运行流程。

## 许可证

MIT。感谢 [CC Switch](https://github.com/farion1231/cc-switch) 的公开项目参考。
