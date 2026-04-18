import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import LoginScreen from "../components/LoginScreen";
import { isAdminAuthenticated, setAdminSession } from "../auth/adminSession";
import { apiUrl } from "../apiBase";

function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const identityLooksValid = useMemo(() => {
    const v = username.trim();
    if (v.length >= 3 && !v.includes("@")) return true;
    return v.length > 3 && v.includes("@") && v.includes(".");
  }, [username]);

  useEffect(() => {
    if (!isAdminAuthenticated()) return;
    const dest = location.state?.from;
    if (dest && dest !== "/admin/login") {
      navigate(dest, { replace: true });
    } else {
      navigate("/admin", { replace: true });
    }
  }, [navigate, location.state]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(apiUrl("/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (res.ok) {
        setAdminSession();
        const dest = location.state?.from;
        if (dest && dest !== "/admin/login") {
          navigate(dest, { replace: true });
        } else {
          navigate("/admin", { replace: true });
        }
        return;
      }
      const apiMsg = typeof data.message === "string" ? data.message.trim() : "";
      const byStatus =
        res.status === 401 || res.status === 403
          ? "Invalid admin credentials."
          : res.status === 503
            ? "Admin login is not configured on the server."
            : res.status === 502 || res.status === 504
              ? "Cannot reach the API (is the backend running on port 1248?)."
              : res.status === 404
                ? "Login API not found (404). Set REACT_APP_API_BASE_URL before `npm run build`, or host the API on the same origin as this site."
                : "";
      setError(apiMsg || byStatus || `Sign in failed (${res.status}).`);
    } catch {
      setError("Unable to reach the server. Is the backend running?");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LoginScreen
      title="AI Agent console"
      titleExtra={
        <span className="rounded-full bg-[#F4ECFF] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[#6D28D9]">
          Admin
        </span>
      }
      subtitle="Sign in with the administrator account from your server configuration. This route is not for workspace or team members."
      showSubtitleBell={false}
      identityFieldIcon="user"
      identityLabel="Admin username"
      identityPlaceholder="admin"
      identityValue={username}
      onIdentityChange={setUsername}
      showIdentityCheck={identityLooksValid}
      password={password}
      onPasswordChange={setPassword}
      remember={remember}
      onRememberChange={setRemember}
      error={error}
      onSubmit={handleSubmit}
      submitting={submitting}
      submitLabel="Enter AI agent console"
      topRightLink={{ to: "/login", label: "Workspace sign-in" }}
      secondaryChild={
        <Link
          to="/login"
          className="inline-flex flex-1 items-center justify-center rounded-full border border-[#ECE3FF] bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#DDD6FE] hover:bg-[#FAFAFF]"
        >
          Open workspace login
        </Link>
      }
    />
  );
}

export default AdminLogin;
