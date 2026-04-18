import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LoginScreen from "../components/LoginScreen";
import { apiUrl } from "../apiBase";
import { setWorkspaceUserId, setWorkspaceUserProfile, triggerWorkspaceLoginPopup } from "../auth/userSession";

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const emailLooksValid = useMemo(() => {
    const v = email.trim();
    if (v.length >= 3 && !v.includes("@")) return true;
    return v.length > 3 && v.includes("@") && v.includes(".");
  }, [email]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(apiUrl("/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: email.trim(),
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
        const userId = data?.user?.id;
        if (userId) {
          setWorkspaceUserId(userId, remember);
        }
        if (data?.user) {
          setWorkspaceUserProfile(data.user, remember);
        }
        const userLabel = data?.user?.username || data?.user?.email || email.trim();
        triggerWorkspaceLoginPopup(userLabel);
        navigate("/dashboard", { replace: true });
        return;
      }
      const apiMsg = typeof data.message === "string" ? data.message.trim() : "";
      const byStatus =
        res.status === 401 || res.status === 403
          ? "Invalid workspace credentials."
          : res.status === 400
            ? "Please enter both username/email and password."
            : res.status === 503
              ? "Workspace login is not configured on the server."
              : res.status === 404
                ? "Login API not found (404). Set REACT_APP_API_BASE_URL before `npm run build`, or host the API on the same origin as this site."
                : res.status === 502 || res.status === 504
                  ? "Cannot reach the API (is the backend running on port 1248?)."
                  : "";
      setError(apiMsg || byStatus || "Could not sign in. Check your details.");
    } catch {
      setError("Unable to reach the server. Is the backend running?");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LoginScreen
      title="Welcome Back"
      subtitle="Sign in with your workspace email (or username) and password to open your command center."
      identityLabel="Email or username"
      identityPlaceholder="admin or you@company.com"
      identityValue={email}
      onIdentityChange={setEmail}
      showIdentityCheck={emailLooksValid}
      password={password}
      onPasswordChange={setPassword}
      remember={remember}
      onRememberChange={setRemember}
      error={error}
      onSubmit={handleSubmit}
      submitting={submitting}
      submitLabel="Login Now"
      secondaryChild={
        <button
          type="button"
          className="flex-1 rounded-full border border-[#ECE3FF] bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#DDD6FE] hover:bg-[#FAFAFF]"
        >
          Create Account
        </button>
      }
    />
  );
}

export default Login;
