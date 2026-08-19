import { Link } from "react-router-dom";
import { Check, Lock, Mail, User } from "lucide-react";
import nexgenaoLogo from "../assets/nexgenaoLogo.jpeg";

/** Set to true when Google / Facebook / X sign-in is ready. */
const SHOW_SOCIAL_LOGIN = false;

/**
 * Shared split login layout for workspace sign-in.
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
  const heading = title || "Welcome back";
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#FCFAFF] px-3 py-6 text-slate-800 sm:px-4 sm:py-8">
      <div className="pointer-events-none absolute -left-24 top-[-120px] h-80 w-80 rounded-full bg-[#d9ceff] blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-24 h-72 w-72 rounded-full bg-[#c5f3f3] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-110px] left-[18%] h-72 w-72 rounded-full bg-[#f6d4ff] blur-3xl" />

      <div className="relative grid w-full max-w-6xl overflow-hidden rounded-2xl border border-white/80 bg-white/90 shadow-[0_30px_80px_rgba(109,40,217,0.16)] backdrop-blur-sm sm:rounded-[30px] lg:grid-cols-[1fr_1fr]">
        <section className="flex justify-center border-b border-[#EFEAFF] px-4 py-8 sm:px-10 sm:py-10 lg:border-b-0 lg:border-r lg:border-[#EFEAFF] lg:px-12">
          <div className="w-full max-w-md">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img src={nexgenaoLogo} alt="NexGenAI logo" className="h-9 w-9 rounded-full object-cover" />
                <div className="leading-tight">
                  <p className="text-base font-bold tracking-tight text-slate-800 md:text-xl">AI Agent</p>
                  <p className="text-[10px] font-light uppercase tracking-[0.14em] text-slate-500">by NexGenAI</p>
                </div>
              </div>
              {topRightLink ? (
                <Link
                  to={topRightLink.to}
                  className="text-xs font-semibold text-[#7C3AED] transition hover:text-[#5B21B6]"
                >
                  {topRightLink.label}
                </Link>
              ) : null}
            </div>

            <h1 className="mt-6 text-xl font-bold tracking-tight text-slate-900 md:mt-10 md:text-4xl lg:text-5xl">
              {heading}
            </h1>
            {titleExtra ? <div className="mt-3">{titleExtra}</div> : null}
            <p className="mt-3 max-w-md text-xs leading-6 text-slate-500 sm:text-sm sm:leading-7">
              {subtitle}
              {showSubtitleBell ? <span className="ml-1 text-[#A78BFA]">✦</span> : null}
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-6">
              <div className="overflow-hidden rounded-2xl border border-[#F0E9FF] bg-white shadow-[0_18px_42px_rgba(139,92,246,0.08)]">
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
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border shadow-sm ${remember ? "border-emerald-500 bg-emerald-500 text-white" : "border-[#E9D5FF] bg-white text-transparent"}`}
                    aria-hidden
                  >
                    {remember ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  Remember me
                </label>
                <button type="button" className="font-medium text-slate-400 transition hover:text-[#8B5CF6]">
                  Forgot password?
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
                  className="flex-1 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#8B5CF6]/35 transition hover:opacity-95 disabled:opacity-60"
                >
                  {submitting ? "Signing in…" : submitLabel}
                </button>
                {secondaryChild}
              </div>
            </form>

            {SHOW_SOCIAL_LOGIN ? null : null}
          </div>
        </section>

        <section className="relative hidden min-h-[620px] overflow-hidden bg-gradient-to-br from-[#F6F2FF] via-[#EFEAFF] to-[#E7DFFF] p-8 lg:flex lg:items-center lg:justify-center">
          <div className="pointer-events-none absolute -right-12 top-[-60px] h-72 w-72 rounded-full bg-[#cdbdff] blur-2xl" />
          <div className="pointer-events-none absolute left-[-70px] top-[170px] h-72 w-72 rounded-full bg-[#bdeeff] blur-2xl" />
          <div className="pointer-events-none absolute bottom-[-120px] right-[14%] h-80 w-80 rounded-full bg-[#d6c7ff] blur-2xl" />

          <div className="relative z-10 w-full max-w-[520px] rounded-[28px] border border-white/70 bg-white/75 p-5 shadow-[0_24px_55px_rgba(90,64,180,0.2)] backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#A78BFA] text-xs font-bold text-white">
                  AI
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Website Chatbot</p>
                  <p className="text-[11px] text-emerald-600">Online now</p>
                </div>
              </div>
              <span className="rounded-full bg-[#F4ECFF] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6D28D9]">
                Live
              </span>
            </div>

            <div className="space-y-3">
              <div className="chat-arrival chat-arrival-1 max-w-[78%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] text-slate-600 shadow-[0_10px_20px_rgba(85,66,145,0.12)]">
                Hey there. I can help with pricing, demos, and onboarding setup.
              </div>
              <div className="chat-arrival chat-arrival-2 ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-3.5 py-2.5 text-[13px] text-white shadow-[0_12px_24px_rgba(139,92,246,0.3)]">
                Nice. Can you show me the best plan for 3 team members?
              </div>
              <div className="chat-arrival chat-arrival-3 max-w-[65%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] text-slate-600 shadow-[0_10px_20px_rgba(85,66,145,0.12)]">
                Absolutely. Pro plan is perfect and includes AI + human handoff.
              </div>
              <div className="chat-arrival chat-arrival-4 max-w-[45%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-slate-500 shadow-[0_10px_20px_rgba(85,66,145,0.12)]">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#A78BFA] animate-bounce" />
                  <span className="h-2 w-2 rounded-full bg-[#A78BFA] animate-bounce [animation-delay:120ms]" />
                  <span className="h-2 w-2 rounded-full bg-[#A78BFA] animate-bounce [animation-delay:240ms]" />
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[#EDE7FF] bg-white/80 px-3 py-2 text-xs text-slate-400">
              Type your message...
            </div>
          </div>
        </section>
      </div>
      <style>{`
        @keyframes chatArrival {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.98);
          }
          18%,
          78% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(6px) scale(0.99);
          }
        }

        .chat-arrival {
          animation-name: chatArrival;
          animation-duration: 6.5s;
          animation-timing-function: ease;
          animation-iteration-count: infinite;
          opacity: 0;
          will-change: transform, opacity;
        }

        .chat-arrival-1 {
          animation-delay: 0ms;
        }
        .chat-arrival-2 {
          animation-delay: 900ms;
        }
        .chat-arrival-3 {
          animation-delay: 1800ms;
        }
        .chat-arrival-4 {
          animation-delay: 2600ms;
        }
      `}</style>
    </div>
  );
}

export default LoginScreen;
