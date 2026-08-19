import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Plug,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { clearWorkspaceUserSession } from "../auth/userSession";
import { SidebarWhatsAppStatus } from "../components/SidebarWhatsAppStatus";
import { WhatsAppAutoRestore } from "../components/WhatsAppAutoRestore";
import nexgenaoLogo from "../assets/nexgenaoLogo.jpeg";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Chats", path: "/chats", icon: MessageSquare },
  { label: "Integrations", path: "/integrations", icon: Plug },
  { label: "Logs", path: "/logs", icon: ScrollText },
  { label: "Knowledgebase", path: "/knowledgebase", icon: BookOpen },
  { label: "Test Bot", path: "/test-bot", icon: Bot },
  { label: "Inquiries", path: "/inquiries", icon: Inbox },
  { label: "Stock loads", path: "/stock-loads", icon: Package },
  { label: "Settings", path: "/settings", icon: Settings },
  { label: "Support", path: "/support", icon: CircleHelp },
];

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <WhatsAppAutoRestore />
      <div className="flex min-h-screen flex-col bg-[#FCFAFF] lg:h-screen lg:overflow-hidden">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#F0E9FF] bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur sm:px-4 lg:hidden" style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}>
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-xl p-2 text-slate-600 transition hover:bg-[#F6F1FF]"
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <img
              src={nexgenaoLogo}
              alt="NexGenAI logo"
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold tracking-tight text-slate-800">AI Agent</p>
              <p className="truncate text-[10px] font-extralight tracking-wide text-slate-500">
                by NexGenAI
              </p>
            </div>
          </div>
        </header>

        <div className="box-border flex min-h-0 w-full flex-1 flex-col p-3 sm:p-4 md:p-5 lg:grid lg:h-full lg:grid-cols-[auto_1fr] lg:gap-5 lg:p-6">
          {mobileNavOpen ? (
            <button
              type="button"
              className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
            />
          ) : null}

          <aside
            className={`fixed inset-y-0 left-0 z-50 flex w-[min(288px,88vw)] flex-col overflow-hidden border-r border-[#F0E9FF] bg-white p-5 shadow-[0_18px_50px_rgba(139,92,246,0.16)] transition-transform duration-300 ease-out lg:relative lg:z-auto lg:h-full lg:min-h-0 lg:w-auto lg:shrink-0 lg:translate-x-0 lg:rounded-3xl lg:border lg:p-6 lg:shadow-[0_18px_50px_rgba(139,92,246,0.08)] ${
              mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
            } ${sidebarCollapsed ? "lg:w-[76px] lg:px-2.5 lg:py-5" : "lg:w-[240px]"}`}
          >
            <div
              className={`mb-8 flex shrink-0 items-center gap-2 lg:mb-10 ${
                sidebarCollapsed ? "lg:mb-6 lg:flex-col lg:items-center lg:justify-center" : "lg:justify-between"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <img
                  src={nexgenaoLogo}
                  alt="NexGenAI logo"
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
                <div className={`min-w-0 leading-tight ${sidebarCollapsed ? "lg:hidden" : ""}`}>
                  <p className="truncate text-base font-bold tracking-tight text-slate-800 md:text-xl lg:text-2xl">
                    AI Agent
                  </p>
                  <p className="truncate text-[10px] font-extralight tracking-wide text-slate-500">
                    by NexGenAI
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-xl p-2 text-slate-500 transition hover:bg-[#F6F1FF] hover:text-slate-800 lg:hidden"
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((c) => !c)}
                className="hidden shrink-0 rounded-xl p-2 text-slate-500 transition hover:bg-[#F6F1FF] hover:text-slate-800 lg:flex"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>
            </div>

            <SidebarWhatsAppStatus collapsed={sidebarCollapsed} />

            <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={item.label}
                  className={({ isActive }) =>
                    `block w-full rounded-xl px-4 py-2.5 text-left text-[13px] font-medium transition md:text-sm ${
                      sidebarCollapsed ? "lg:px-2" : ""
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
                      sidebarCollapsed ? "lg:justify-center lg:gap-0" : ""
                    }`}
                  >
                    <item.icon size={16} className="shrink-0" />
                    <span className={sidebarCollapsed ? "lg:sr-only" : ""}>{item.label}</span>
                  </span>
                </NavLink>
              ))}
            </nav>

            <div className="mt-4 shrink-0 border-t border-[#EEE8FF] pt-4 lg:mt-auto">
              <button
                type="button"
                title="Log out"
                onClick={() => {
                  clearWorkspaceUserSession();
                  navigate("/login", { replace: true });
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-4 py-2.5 text-left text-[13px] font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-700 md:text-sm ${
                  sidebarCollapsed ? "lg:justify-center lg:px-2" : ""
                }`}
              >
                <LogOut size={16} className="shrink-0" />
                <span className={sidebarCollapsed ? "lg:sr-only" : ""}>Log out</span>
              </button>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:h-full">
            <Outlet />
          </div>
        </div>
      </div>
    </>
  );
}

export default AppLayout;
