import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plug,
  Settings,
} from "lucide-react";
import { clearWorkspaceUserSession } from "../auth/userSession";
import nexgenaoLogo from "../assets/nexgenaoLogo.jpeg";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Chats", path: "/chats", icon: MessageSquare },
  { label: "Integrations", path: "/integrations", icon: Plug },
  { label: "Knowledgebase", path: "/knowledgebase", icon: BookOpen },
  { label: "Test Bot", path: "/test-bot", icon: Bot },
  { label: "Inquiries", path: "/inquiries", icon: Inbox },
  { label: "Settings", path: "/settings", icon: Settings },
  { label: "Support", path: "/support", icon: CircleHelp },
];

function AppLayout() {
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#FCFAFF] xl:h-screen xl:overflow-hidden">
      <div className="box-border grid h-full min-h-0 w-full grid-cols-1 gap-5 p-4 md:p-6 xl:h-full xl:grid-cols-[auto_1fr]">
        <aside
          className={`sticky top-4 flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] transition-[width,padding] duration-300 ease-out xl:h-full xl:max-h-none xl:min-h-0 xl:shrink-0 ${
            sidebarCollapsed ? "xl:w-[76px] xl:px-2.5 xl:py-5" : "xl:w-[240px]"
          }`}
        >
          <div
            className={`mb-10 shrink-0 flex items-center gap-2 ${
              sidebarCollapsed ? "xl:mb-6 xl:flex-col xl:items-center xl:justify-center" : "xl:justify-between"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <img
                src={nexgenaoLogo}
                alt="NexGenAI logo"
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
              <div
                className={`min-w-0 leading-tight ${
                  sidebarCollapsed ? "xl:hidden" : ""
                }`}
              >
                <p className="truncate text-xl font-bold tracking-tight text-slate-800 md:text-2xl">
                  AI Agent
                </p>
                <p className="truncate text-[10px] font-extralight tracking-wide text-slate-500">
                  by NexGenAI
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="hidden shrink-0 rounded-xl p-2 text-slate-500 transition hover:bg-[#F6F1FF] hover:text-slate-800 xl:flex"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>

          <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={item.label}
                className={({ isActive }) =>
                  `block w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition ${
                    sidebarCollapsed ? "xl:px-2" : ""
                  } ${
                    isActive
                      ? "bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] text-white shadow-lg shadow-[#8B5CF6]/35"
                      : "text-slate-600 hover:bg-[#F6F1FF]"
                  }`
                }
                end
              >
                <span
                  className={`flex items-center gap-2.5 ${
                    sidebarCollapsed ? "xl:justify-center xl:gap-0" : ""
                  }`}
                >
                  <item.icon size={16} className="shrink-0" />
                  <span className={sidebarCollapsed ? "xl:sr-only" : ""}>{item.label}</span>
                </span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-4 shrink-0 border-t border-[#EEE8FF] pt-4 xl:mt-auto">
            <button
              type="button"
              title="Log out"
              onClick={() => {
                clearWorkspaceUserSession();
                navigate("/login", { replace: true });
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-4 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-700 ${
                sidebarCollapsed ? "xl:justify-center xl:px-2" : ""
              }`}
            >
              <LogOut size={16} className="shrink-0" />
              <span className={sidebarCollapsed ? "xl:sr-only" : ""}>Log out</span>
            </button>
          </div>
        </aside>

        <div className="min-h-0 min-w-0 xl:flex xl:h-full xl:min-h-0 xl:flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default AppLayout;
