import { Link } from "react-router-dom";
import { Bell, Check, Lock, Mail, User } from "lucide-react";
import logAsset from "../assets/log-assetremovebg.png";
// import logAsset from "../assets/log-asset.jpg.jpg";

/** Set to true when Google / Facebook / X sign-in is ready. */
const SHOW_SOCIAL_LOGIN = false;

/**
 * Shared split login layout (matches `/login` UI) for workspace and admin routes.
 */
function LoginScreen({
  title,
  titleExtra,
  subtitle,
  showSubtitleBell = true,
  identityLabel,
  identityPlaceholder,
  identityFieldIcon = "mail",
  identityValue,
  onIdentityChange,
  showIdentityCheck,
  password,
  onPasswordChange,
  remember,
  onRememberChange,
  error,
  onSubmit,
  submitting,
  submitLabel = "Login Now",
  secondaryChild,
  topRightLink,
}) {
  const IdentityIcon = identityFieldIcon === "user" ? User : Mail;
  return (
    <div className="relative min-h-screen bg-white text-slate-800">
      <div className="absolute left-5 right-5 top-5 z-20 flex flex-wrap items-start justify-between gap-3 sm:left-8 sm:right-8 sm:top-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#FB923C]" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xl font-bold tracking-tight text-[#5B21B6]">AI Agent</p>
            <p className="truncate text-[10px] font-extralight tracking-wide text-slate-500">
              by NexGenAI
            </p>
          </div>
        </div>
        {topRightLink ? (
          <Link
            to={topRightLink.to}
            className="text-sm font-semibold text-[#7C3AED] transition hover:text-[#5B21B6]"
          >
            {topRightLink.label}
          </Link>
        ) : null}
      </div>

      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[12fr_10fr]">
        <section className="relative hidden min-h-0 overflow-hidden bg-[#FCFAFF] lg:flex lg:items-center lg:justify-center">
          <div
            className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-[#EDE9FE]/80 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute bottom-8 right-0 h-64 w-64 rounded-full bg-[#FEF3E8]/70 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute right-1/4 top-1/4 h-40 w-40 rounded-full border border-dashed border-[#C4B5FD]/40"
            aria-hidden
          />
          <img
            src={logAsset}
            alt=""
            className="relative z-[1] w-full max-w-[min(96vw,680px)] object-contain px-4 py-8 drop-shadow-[0_24px_56px_rgba(139,92,246,0.16)] lg:max-w-[min(52vw,640px)] lg:px-6 lg:py-6 xl:max-w-[720px]"
          />
        </section>

        <section className="flex flex-col justify-center px-5 pb-10 pt-20 sm:px-10 lg:px-12 lg:pb-12 lg:pt-16 xl:pr-20">
          <div className="mx-auto w-full max-w-md">
            <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-[2rem]">
              <span>{title}</span>
              {titleExtra}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm leading-relaxed text-slate-500">
              {subtitle}
              {showSubtitleBell ? (
                <Bell className="inline-block h-4 w-4 shrink-0 text-[#C4B5FD]" aria-hidden />
              ) : null}
            </div>

            <form onSubmit={onSubmit} className="mt-10 space-y-6">
              <div className="overflow-hidden rounded-2xl border border-[#F0E9FF] bg-white shadow-[0_18px_50px_rgba(139,92,246,0.06)]">
                <label className="block border-b border-[#F0E9FF] bg-[#FDFCFF] px-4 pb-3 pt-3.5 transition-colors focus-within:bg-[#FAF7FF]">
                  <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
                    <IdentityIcon className="h-3.5 w-3.5 text-[#A78BFA]" strokeWidth={2} />
                    {identityLabel}
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      value={identityValue}
                      onChange={(e) => onIdentityChange(e.target.value)}
                      placeholder={identityPlaceholder}
                      className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-0"
                    />
                    {showIdentityCheck ? (
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
                        aria-label="Valid input"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                    ) : null}
                  </div>
                </label>
                <label className="block bg-white px-4 pb-3.5 pt-3 focus-within:bg-[#FAFAFA]">
                  <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
                    <Lock className="h-3.5 w-3.5 text-[#A78BFA]" strokeWidth={2} />
                    Password
                  </span>
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => onPasswordChange(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1 w-full border-0 bg-transparent p-0 text-sm font-medium tracking-wide text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-0"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer select-none items-center gap-2 text-slate-500">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => onRememberChange(e.target.checked)}
                    className="sr-only"
                  />
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border shadow-sm focus-within:ring-2 focus-within:ring-[#8B5CF6]/40 ${remember
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-[#E9D5FF] bg-white text-transparent"
                      }`}
                    aria-hidden
                  >
                    {remember ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  Remember Me
                </label>
                <button
                  type="button"
                  className="font-medium text-slate-400 transition hover:text-[#8B5CF6]"
                >
                  Forget Password?
                </button>
              </div>

              {error ? (
                <p className="text-sm font-medium text-red-600" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#8B5CF6]/35 transition hover:opacity-95 disabled:opacity-60"
                >
                  {submitting ? "Signing in…" : submitLabel}
                </button>
                {secondaryChild}
              </div>
            </form>

            {SHOW_SOCIAL_LOGIN ? (
              <div className="mt-12">
                <p className="text-center text-xs font-medium text-slate-400">
                  Or you can join with
                </p>
                <div className="mt-5 flex justify-center gap-5">
                  <button
                    type="button"
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[13px] font-bold text-slate-600 shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-black/5 transition hover:shadow-[0_10px_28px_rgba(139,92,246,0.12)]"
                    aria-label="Continue with Google"
                  >
                    <span className="bg-gradient-to-br from-[#4285F4] via-[#EA4335] to-[#FBBC05] bg-clip-text text-transparent">
                      G
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1877F2] text-sm font-bold text-white shadow-[0_8px_24px_rgba(24,119,242,0.35)] transition hover:brightness-105"
                    aria-label="Continue with Facebook"
                  >
                    f
                  </button>
                  <button
                    type="button"
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1D9BF0] text-white shadow-[0_8px_24px_rgba(29,155,240,0.35)] transition hover:brightness-105"
                    aria-label="Continue with X"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="relative order-3 flex min-h-[260px] items-center justify-center overflow-hidden bg-gradient-to-b from-[#FCFAFF] to-white px-6 py-10 lg:hidden">
        <div
          className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-[#EDE9FE]/70 blur-2xl"
          aria-hidden
        />
        <img
          src={logAsset}
          alt=""
          className="relative z-[1] max-h-[min(42vh,380px)] w-full max-w-lg object-contain drop-shadow-[0_20px_48px_rgba(139,92,246,0.14)]"
        />
      </section>
    </div>
  );
}

export default LoginScreen;
