# 重置版开发状态

更新时间：2026-09-10

## 当前结论

重置版已建立在独立目录 `hermes-provider-switcher-reset-ccs-core` 中，采用 Tauri 2 + Rust 核心，并以 Hermes Provider Switcher 为产品品牌。旧 Electron 项目、旧实验包和参考缓存均未覆盖。

## 已完成

- 保留 CCS 参考中的供应商、平台配置、路由、故障转移、模型目录、MCP、Skills、提示词、Profile、会话、同步、备份、OAuth 和工具管理模块。
- 增加紧凑工作台导航，并对大型设置、资源、供应商表单和弹窗做按需加载。
- 启动阶段移除自动工具版本探测和自动更新请求；更新检查改为 8 秒级限时 Release 元数据查询。
- 修复更新命令参数的 camelCase 传递、严格 SemVer 比较、无 Release 状态和响应大小上限。
- 移除未配置签名的内置自动安装入口，更新入口改为可靠地打开发布页。
- 默认数据目录与错误提示统一为 `.hermes-provider-switcher-reset`；支持 `HERMES_PROVIDER_SWITCHER_DATA_DIR` 和便携模式，Windows WebView2 数据也随便携数据目录保存。
- 移除前端生产依赖 `js-yaml`；`smol-toml` 固定到 1.6.1，生产依赖审计为 0 条告警。
- 修复懒加载弹窗缺少 Suspense、Profiles mock 响应形状错误、集成测试未等待懒加载弹窗等问题。
- 将窗口标题、深链接协议、User-Agent、主题和本地存储键切换到 Hermes Provider Switcher 命名空间。

## 已验证

- `pnpm run typecheck`：通过。
- `pnpm run build:renderer`：通过；主入口约 1.6 MB，较早版本约 4.2 MB 明显下降。
- `pnpm exec vitest run tests/integration/App.test.tsx --testTimeout=15000 --maxWorkers=1 --minWorkers=1`：4/4 通过。
- `pnpm audit --prod --json`：0 条漏洞告警。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`：2179 通过，2 忽略。
- `pnpm exec vitest run --maxWorkers=1 --minWorkers=1`：79 个测试文件、522 个测试全部通过。
- JSON、Tauri 配置和本地化文件解析：通过。

## 构建结果

- 已完成 Windows Release 构建，并通过便携版启动冒烟测试。
- 免安装版：`release-reset-v0.3.0/Hermes Provider Switcher Portable v0.3.0.exe`。
- 已重新生成光环黑洞应用图标，并重新构建免安装版使新图标生效。
- 便携版旁的 `portable.ini` 使数据库、日志、备份和 WebView2 数据留在 D 盘产物目录。
- 自动更新仍保持“检查 Release 后打开发布页”，未配置签名流水线时不执行后台安装。

## 集成回归补充

- 使用单任务构建（`CARGO_BUILD_JOBS=1`）和关闭增量编译解决了集成测试构建时的分页文件不足问题，不涉及修改系统分页设置。
- 修正独立集成测试中仍指向旧数据目录的路径；配置加载、供应商切换、路由、MCP、Profile、导入导出、Skills 备份恢复测试已通过。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --tests -j1` 最终退出码为 0。Windows 符号链接清理测试标为忽略，原因是当前账户缺少创建符号链接的权限；该项需在具备权限的 Windows 环境显式运行忽略测试。
