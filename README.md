# Hermes Provider Switcher

Hermes Provider Switcher 是一个面向 Hermes Agent 的第三方模型供应商切换器。它把 Hermes 固定连接到本地 API 路由器，再由本工具转发到 DeepSeek、OpenRouter、Moyyu、OneAPI 或其他 OpenAI 兼容接口。

## 核心能力

- 管理多个第三方模型供应商
- 一键把 Hermes `config.yaml` 初始化为本地路由模式
- 本地路由地址固定为 `http://127.0.0.1:15722/v1`
- 在软件内切换供应商，下一次 Hermes 请求立即走新的 API
- 支持模型名映射，例如 `gpt-4o=deepseek-chat`
- 支持删除第三方接口可能不兼容的字段：
  - `tools`
  - `tool_choice`
  - `parallel_tool_calls`
  - `reasoning_effort`
- 支持自定义请求头
- 支持测试连接和拉取 `/v1/models`
- 写入 Hermes 配置前自动备份原文件

## 工作原理

```text
Hermes Agent
  ↓
http://127.0.0.1:15722/v1
  ↓
Hermes Provider Switcher 本地路由器
  ↓
第三方 API 供应商
```

第一次使用时需要把 Hermes 配置初始化到本地路由器。之后切换模型供应商只需要在本软件中点击“设为当前供应商”，不需要反复修改 Hermes 配置。

## 下载

在 GitHub Releases 中下载：

- `Hermes Provider Switcher Setup 1.0.0.exe`：安装版
- `Hermes Provider Switcher 1.0.0.exe`：免安装版

## 使用方法

1. 打开 Hermes Provider Switcher。
2. 点击“选择配置”，选择 Hermes 的 `config.yaml`，例如：

```text
D:\AI\Hermes\config.yaml
```

3. 点击“新建供应商”，填写：

```text
供应商名称
Base URL
API Key
默认模型
模型列表
模型映射
```

4. 点击“设为当前供应商”。
5. 点击“启动路由器”。
6. 点击“初始化 Hermes 路由”。
7. 重启 Hermes Agent。

之后切换供应商时，只需要在本软件中选择供应商并点击“设为当前供应商”。
<img width="1809" height="1175" alt="image" src="https://github.com/user-attachments/assets/3a3cdfe0-303a-4977-82c7-c933918b2520" />


## Hermes 配置示例

工具会把 Hermes 的 `model` 和 `custom_providers` 写成类似下面的结构：

```yaml
model:
  provider: hermes-switcher
  default: gpt-5.5
  base_url: http://127.0.0.1:15722/v1
  api_mode: chat_completions

custom_providers:
- name: hermes-switcher
  base_url: http://127.0.0.1:15722/v1
  api_key: local-router
  api_mode: chat_completions
  model: gpt-5.5
  models:
    gpt-5.5:
      name: gpt-5.5
```

`custom_providers` 会保持 YAML list 格式，不会写成 `"0":` 这种错误结构。

## 开发运行

```bash
npm install
npm run dev
```

Windows 也可以使用：

```bash
node dev.js
```

## Windows 打包

```bash
npm run dist
```

或者双击：

```text
dist-windows.bat
```

打包产物在 `release/` 目录。

## 技术栈

- Electron 31
- React 18
- TypeScript 5
- Vite
- js-yaml

## 项目结构

```text
src/main/main.ts       Electron 主进程、IPC、本地路由器、Hermes YAML 写入
src/main/preload.ts    contextBridge 安全 API
src/renderer/App.tsx   主界面
src/renderer/styles.css 样式
src/shared/types.ts    共享类型
```

## 本地数据

软件自身配置保存于：

```text
%USERPROFILE%\.hermes-provider-switcher\config.json
```

该文件可能包含 API Key，不要上传到 GitHub。

## 注意事项

- 修改 Hermes 配置后需要重启 Hermes Agent。
- 如果端口 `15722` 被占用，可以在软件中修改路由端口。
- 如果第三方 API 的真实模型名和 Hermes 里使用的模型名不同，请配置“模型映射”。
- 本项目不会内置任何 API Key。

## License

MIT
