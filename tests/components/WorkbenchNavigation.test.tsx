import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchNavigation } from "@/components/WorkbenchNavigation";

afterEach(cleanup);
describe("Hermes workbench navigation", () => {
  const props = { view: "skills", onNavigate: vi.fn(), activeApp: "hermes" as const,
    onSwitch: vi.fn(), visibleApps: { hermes: true, claude: true, codex: false, "claude-desktop": false, gemini: false, grokbuild: false, opencode: false, openclaw: false }, running: false };
  it("groups resource pages and opens settings", () => {
    render(<WorkbenchNavigation {...props} />);
    expect(screen.getByRole("button", { name: "资源库" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "应用设置" }));
    expect(props.onNavigate).toHaveBeenCalledWith("settings");
  });
  it("switches only visible platforms and saves the choice", () => {
    render(<WorkbenchNavigation {...props} />);
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }));
    expect(props.onSwitch).toHaveBeenCalledWith("claude");
    expect(localStorage.getItem("hermes-provider-switcher-last-app")).toBe("claude");
    expect(screen.getByRole("button", { name: "Hermes" })).toHaveAttribute("aria-pressed", "true");
  });
  it("displays actual running state", () => {
    const { rerender } = render(<WorkbenchNavigation {...props} />);
    expect(screen.getByText("路由已停止")).toBeInTheDocument();
    rerender(<WorkbenchNavigation {...props} running />);
    expect(screen.getByText("路由运行中")).toBeInTheDocument();
  });
});
