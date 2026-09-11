import { LayoutDashboard, Library, History, Settings } from "lucide-react";
import { AppSwitcher } from "@/components/AppSwitcher";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import blackhole from "@/assets/hermes-blackhole.png";
import { cn } from "@/lib/utils";

export const WORKSPACES = [
  {
    label: "路由中枢",
    icon: LayoutDashboard,
    views: ["providers", "universal"],
  },
  {
    label: "资源库",
    icon: Library,
    views: [
      "mcp",
      "skills",
      "skillsDiscovery",
      "prompts",
      "agents",
      "hermesMemory",
    ],
  },
  {
    label: "运行记录",
    icon: History,
    views: [
      "sessions",
      "workspace",
      "openclawEnv",
      "openclawTools",
      "openclawAgents",
    ],
  },
  { label: "应用设置", icon: Settings, views: ["settings"] },
];

export function WorkbenchNavigation({
  view,
  onNavigate,
  activeApp,
  onSwitch,
  visibleApps,
  running,
}: {
  view: string;
  onNavigate: (view: string) => void;
  activeApp: AppId;
  onSwitch: (app: AppId) => void;
  visibleApps: VisibleApps;
  running: boolean;
}) {
  return (
    <aside className="hermes-rail">
      <div className="hermes-brand">
        <img src={blackhole} alt="光环黑洞" width={38} height={38} />
        <div>
          <strong>Hermes</strong>
          <span>Provider Switcher</span>
        </div>
      </div>
      <nav aria-label="工作区导航" className="hermes-workspaces">
        {WORKSPACES.map(({ label, icon: Icon, views }) => (
          <button
            key={label}
            type="button"
            aria-current={views.includes(view) ? "page" : undefined}
            className={cn(
              "hermes-nav-button",
              views.includes(view) && "is-selected",
            )}
            onClick={() => onNavigate(views[0])}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="hermes-platform-heading">平台</div>
      <div className="hermes-platforms">
        <AppSwitcher
          activeApp={activeApp}
          onSwitch={onSwitch}
          visibleApps={visibleApps}
          vertical
        />
      </div>
      <div className="hermes-rail-footer">
        <span className={cn("hermes-status-dot", running && "is-running")} />
        路由{running ? "运行中" : "已停止"}
        <span className="ml-auto">v0.3.0</span>
      </div>
    </aside>
  );
}
