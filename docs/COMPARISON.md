# 本地版本、参考版本与重置版对比

## 核对对象

- 原项目：`D:\AI\智能体工作目录\claude工作目录\Hermes第三方模型工具\hermes-provider-switcher`，本地 HEAD `c34b061`，版本 `0.2.0`，Electron 31；目录存在用户修改，未被重置版覆盖。
- CCS 参考缓存：`reference-cc-switch`，已核对本地 HEAD `878c26f`，缓存版本 `3.18.0`。
- GitHub 参考：截至 2026-09-09 读取到 `farion1231/cc-switch` 提交 `2d54e261c8a2f9e5b791e566c83048796bb2364b`；远程版本与本地缓存不视为同一份代码。
- 重置版：`hermes-provider-switcher-reset-ccs-core`，版本 `0.3.0`，Tauri 2 + Rust。

## 差异摘要

| 方面 | 原项目 | CCS 参考 | 重置版处理 |
| --- | --- | --- | --- |
| 运行时 | Electron/React | Tauri/React/Rust | 采用 Tauri + Rust，保留配置服务和平台适配 |
| 数据模型 | Hermes 配置与应用配置 | SQLite、统一资源、平台快照 | 使用独立 SQLite，Hermes YAML 作为平台投影，默认新目录 |
| 平台 | 早期以 Hermes 路由为重点，后续包含多平台改动 | 多 Agent、多协议、多供应商 | 按平台分组迁移真实命令与配置写入逻辑 |
| 资源 | 路由、模型、MCP/Skills 基础能力 | MCP、Skills、Prompt、Profile、同步、备份、检测 | 保留模块，并放入单页工作台入口 |
| 启动 | Electron/WebView 常驻开销较高，检查容易与启动耦合 | Tauri 原生壳 | 不在启动时联网/扫描，资源面板和弹窗按需加载 |
| 更新 | 旧更新检查/安装流程 | 签名 updater | 当前只做限时元数据检查和发布页入口，待正式签名流水线后再启用自动安装 |
| 数据安全 | 旧目录可能与新目录混用 | CCS 目录 | 新目录、D 盘环境变量和便携模式；不自动迁移旧库 |

## 发布核验结论

- Windows 免安装版已完成构建，并在独立 D 盘数据目录启动验证。
- 代码、渲染器、Rust 单元测试和前端全量测试均已通过；真实第三方凭据与线上平台回归仍应由使用者在自己的配置中验证。
- 未配置签名密钥和发布资产前，不启用静默自动升级。
