# Hermes Provider Switcher

一个用于 Hermes Agent 的第三方模型供应商切换工具。你可以在软件里维护多个 OpenAI 兼容 API 供应商，一键写入 Hermes 的 `config.yaml`，并通过本地代理做模型名映射和请求字段清洗。

## 功能

- 管理多个自定义模型供应商
- 自动写入 Hermes `model` 和 `custom_providers` 配置
- 写入前自动备份原始 `config.yaml`
- 内置本地 HTTP 代理：`Hermes -> 127.0.0.1:<端口>/v1 -> 第三方 API`
- 支持模型名映射，例如 `gpt-4o=deepseek-chat`
- 支持删除 `tools`、`tool_choice`、`parallel_tool_calls`、`reasoning_effort` 等第三方 API 可能不兼容的字段
- 支持自定义请求头
- 支持测试连接和从 `/v1/models` 拉取模型列表

## 快速启动

```bash
npm install
npm run dev
```

Windows 也可以直接运行：

```bash
node dev.js
```

## Windows 打包

双击运行：

```bat
dist-windows.bat
```

脚本会自动清理旧产物、安装依赖、构建并打包。完成后产物会在 `release/` 目录：

- `Hermes Provider Switcher Setup x.x.x.exe`：安装版
- `Hermes Provider Switcher x.x.x.exe`：免安装便携版
- `win-unpacked/Hermes Provider Switcher.exe`：解压版，可用于快速测试

## 使用方法

1. 点击“选择配置”，选择 Hermes 的 `config.yaml`，例如 `D:\AI\Hermes\config.yaml`。
2. 点击“新建供应商”，填写供应商名称、Base URL、API Key 和默认模型。
3. 如果第三方 API 不兼容 Hermes 的工具调用字段，保持“启用本地代理”和“删除 tools/tool_choice 等字段”开启。
4. 点击“启动代理”。
5. 点击“应用到 Hermes”。
6. 重启 Hermes Agent。

## 写入 Hermes 的 YAML 示例

```yaml
model:
  provider: moyyu
  default: gpt-5.4-mini
  base_url: http://127.0.0.1:15722/v1
  api_mode: chat_completions

custom_providers:
- name: moyyu
  base_url: http://127.0.0.1:15722/v1
  api_key: your-api-key
  api_mode: chat_completions
  model: gpt-5.4-mini
  models:
    gpt-5.4-mini:
      name: gpt-5.4-mini
```

`custom_providers` 会保持 YAML list 格式，不会写成 `"0":` 这种对象格式。

## 本地配置

软件自身配置保存在：

```text
%USERPROFILE%\.hermes-provider-switcher\config.json
```

该文件包含 API Key，不要上传到 GitHub。

## 开发说明

技术栈：

- Electron 31
- React 18
- TypeScript 5
- Vite
- js-yaml

主要文件：

- `src/main/main.ts`：Electron 主进程、IPC、本地代理、Hermes YAML 写入
- `src/main/preload.ts`：通过 `contextBridge` 暴露安全 API
- `src/renderer/App.tsx`：主界面
- `src/shared/types.ts`：共享类型和 IPC 通道名

## 注意

- 修改 Hermes 配置后需要重启 Hermes Agent。
- 如果端口被占用，可以在供应商配置里修改代理端口。
- 如果第三方 API 的真实模型名和 Hermes 里显示的模型名不同，请使用“模型映射”。
