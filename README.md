# Hermes Provider Switcher

`Hermes Provider Switcher v0.2.0` 是 Windows 桌面端的第三方模型供应商管理工具。它将 Hermes 或其他 AI 客户端接入本地路由，统一管理供应商、模型映射、资源同步与快速平台切换。

## 功能

- 管理多个 OpenAI 兼容 API 供应商，并在应用内快速切换。
- 支持 Hermes、Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw。
- 本地路由模式：模型映射、自定义请求头、兼容字段清理、备用供应商故障切换。
- Hermes 原生直连模式，按需写入 `config.yaml`；写入前自动备份。
- 自动检测目标应用配置，支持一键应用当前供应商。
- 独立管理与同步 MCP 服务器、提示词、Skills。
- 导入/导出本地数据、默认工作区、路由用量记录和 Windows 开机启动。
- 默认浅色主题，并跟随系统深浅色模式。

## 本地路由

```text
Hermes / AI Client
        |
http://127.0.0.1:15722/v1
        |
Hermes Provider Switcher
        |
Third-party OpenAI-compatible API
```

本地路由模式下，客户端固定连接本地地址。之后切换供应商、模型映射或请求头，不需要反复修改 Hermes 的配置。

## 使用方式

1. 打开软件，在供应商工作台新建供应商并填写 Base URL、API Key 和默认模型。
2. 使用“测试连接”或“拉取模型”确认接口可用，然后设为当前供应商。
3. 在“设置 -> 通用”选择 Hermes 的 `config.yaml`。
4. 在“目标应用”选择 Hermes 或其他已检测到的平台，应用当前供应商。
5. 启动本地路由；首次使用 Hermes 后重启 Hermes 应用。

可在“设置 -> 本地路由”调整端口、接入模式、自动启动与备用供应商。

## 构建与打包

```bash
npm install
npm run dev
```

构建应用：

```bash
npm run build
```

Windows 打包：

```bash
npm run dist
```

也可运行 `dist-windows.bat`。输出包含 NSIS 安装包、Portable 免安装包以及 `win-unpacked` 解压版。

## 本地数据与安全

应用配置保存在：

```text
%USERPROFILE%\.hermes-provider-switcher\config.json
```

该文件可能包含 API Key。请勿上传该文件、导出文件或截图中的密钥到公开仓库。软件不会内置或上传 API Key。

## 技术栈

- Electron 31
- React 18
- TypeScript 5
- Vite
- js-yaml

## 开源协议

MIT
