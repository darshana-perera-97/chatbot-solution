import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import avatarAntonion from "../assets/avatar-antonion.svg";
import avatarDhea from "../assets/avatar-dhea.svg";
import avatarRina from "../assets/avatar-rina.svg";
import avatarZaenal from "../assets/avatar-zaenal.svg";
import { landingPageData } from "../data/landingPageData";

function LandingPage() {
  const { brand, navLinks, hero, services, logoCarousel, setup, blog, stats, faq, contact, footer } = landingPageData;
  const [openFaqIndex, setOpenFaqIndex] = useState(0);
  const logoCarouselRef = useRef(null);
  const serviceIconClasses =
    "h-5 w-5 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)]";
  const serviceIcons = [
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={serviceIconClasses}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <path d="M8 9h8M8 13h6" />
    </svg>,
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={serviceIconClasses}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </svg>,
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={serviceIconClasses}>
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 3 3 5-6" />
      <circle cx="7" cy="14" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="11" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="13" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="7" r="1.2" fill="currentColor" stroke="none" />
    </svg>,
  ];
  const scrollLogoCarousel = (direction) => {
    if (!logoCarouselRef.current) return;
    const amount = direction === "left" ? -260 : 260;
    logoCarouselRef.current.scrollBy({ left: amount, behavior: "smooth" });
  };

  return (
    <main className="min-h-screen w-full bg-[#f3f5fb] text-[#17162f]">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 top-[-120px] h-80 w-80 rounded-full bg-[#d9ceff] blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-24 h-72 w-72 rounded-full bg-[#c5f3f3] blur-3xl" />
        <div className="mx-auto w-full max-w-7xl px-6 pb-16 pt-8 md:px-9 md:pt-10">
            <header className="sticky top-4 z-20 mb-2 flex items-center justify-between gap-6 rounded-2xl border border-white/60 bg-white/55 px-4 py-3 shadow-[0_10px_30px_rgba(31,41,55,0.08)] backdrop-blur-xl md:px-5">
              <span className="flex flex-col leading-tight">
                <span className="text-xl font-extrabold tracking-tight text-[#4f36c9]">
                  {brand.product}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7b74a8]">
                  {brand.byline}
                </span>
              </span>
            <nav className="hidden items-center gap-5 md:flex">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  className="text-sm font-medium text-[#68658a] no-underline transition hover:text-[#4f36c9]"
                  href={link.href}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <Link
              className="rounded-full border border-[#d7cffd] bg-white/80 px-5 py-2.5 text-sm font-bold text-[#4f36c9] no-underline transition hover:border-[#c6bbfb] hover:bg-[#f8f6ff]"
              to="/login"
            >
              Sign in
            </Link>
            </header>

            <section className="grid grid-cols-1 gap-8 py-14 lg:grid-cols-[1.08fr_1fr]">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#776dba]">
                  {hero.kicker}
                </p>
                <h1 className="mb-5 max-w-[560px] text-4xl font-bold leading-[1.02] tracking-[-0.02em] md:text-6xl">
                  {hero.title}
                </h1>
                <p className="mb-7 max-w-[560px] text-base leading-8 text-[#5f5a84] md:text-lg">{hero.description}</p>
                <div className="mb-7 flex flex-wrap gap-3">
                  <a
                    className="rounded-full bg-gradient-to-r from-[#6d50ff] to-[#5236d8] px-6 py-3 text-sm font-bold text-white no-underline shadow-[0_14px_32px_rgba(82,54,216,0.35)] transition hover:translate-y-[-1px]"
                    href={hero.primaryCtaHref}
                  >
                    {hero.primaryCtaLabel}
                  </a>
                  <Link
                    className="rounded-full border border-[#ddd6ff] bg-white px-6 py-3 text-sm font-bold text-[#5f45db] no-underline transition hover:bg-[#f7f4ff]"
                    to="/dashboard"
                  >
                    {hero.secondaryCtaLabel}
                  </Link>
                </div>
                <div className="flex items-center gap-2 text-[13px] text-[#7772a0]">
                  {[avatarAntonion, avatarDhea, avatarRina, avatarZaenal].map((avatar) => (
                    <img
                      key={avatar}
                      src={avatar}
                      alt="advisor"
                      className="-mr-1.5 h-8 w-8 rounded-full border-2 border-white shadow-[0_12px_24px_rgba(63,37,143,0.24)]"
                    />
                  ))}
                  <span className="ml-2.5 font-medium">{hero.trustText}</span>
                </div>
              </div>
              <div className="relative rounded-[28px] border border-white/60 bg-[radial-gradient(circle_at_28%_2%,#f2eeff,#e8e3ff_60%,#ddd6ff_100%)] p-6 shadow-[0_24px_50px_rgba(88,74,153,0.22)]">
                <div className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_24px_55px_rgba(90,64,180,0.2)] backdrop-blur-sm">
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
                    <div className="lp-chat-arrival lp-chat-arrival-1 max-w-[78%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] text-slate-600 shadow-[0_10px_20px_rgba(85,66,145,0.12)]">
                      Hey there. I can help with pricing, demos, and onboarding setup.
                    </div>
                    <div className="lp-chat-arrival lp-chat-arrival-2 ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-3.5 py-2.5 text-[13px] text-white shadow-[0_12px_24px_rgba(139,92,246,0.3)]">
                      Nice. Can you show me the best plan for 3 team members?
                    </div>
                    <div className="lp-chat-arrival lp-chat-arrival-3 max-w-[65%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] text-slate-600 shadow-[0_10px_20px_rgba(85,66,145,0.12)]">
                      Absolutely. Pro plan is perfect and includes AI + human handoff.
                    </div>
                    <div className="lp-chat-arrival lp-chat-arrival-4 max-w-[45%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-slate-500 shadow-[0_10px_20px_rgba(85,66,145,0.12)]">
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
              </div>
            </section>

          <section className="mt-10 rounded-3xl border border-[#ece9fb] bg-white/85 p-5 shadow-[0_16px_34px_rgba(74,67,119,0.08)] md:mt-12 md:p-6">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <span className="inline-flex rounded-full border border-[#ddd5ff] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6047da]">
                  {logoCarousel.label}
                </span>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-[#2f2a4e] md:text-2xl">
                  {logoCarousel.title}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollLogoCarousel("left")}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#ddd5ff] bg-white text-[#5e46d7] shadow-[0_8px_18px_rgba(74,67,119,0.12)] transition hover:bg-[#f5f2ff]"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => scrollLogoCarousel("right")}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#ddd5ff] bg-white text-[#5e46d7] shadow-[0_8px_18px_rgba(74,67,119,0.12)] transition hover:bg-[#f5f2ff]"
                >
                  →
                </button>
              </div>
            </div>
            <div
              ref={logoCarouselRef}
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {logoCarousel.logos.map((logo) => (
                <article
                  key={logo.name}
                  className="snap-start flex min-w-[170px] items-center justify-center rounded-2xl border border-[#ece9fb] bg-gradient-to-br from-white to-[#f8f6ff] p-4 shadow-[0_10px_22px_rgba(74,67,119,0.08)]"
                >
                  <img src={logo.image} alt={logo.name} className="h-9 w-auto object-contain" />
                </article>
              ))}
            </div>
          </section>

          <section className="mt-10 md:mt-12" id="services">
            <div className="mb-5 md:mb-6">
              <span className="inline-flex rounded-full border border-[#ddd5ff] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6047da]">
                Core Features
              </span>
              <h2 className="mt-3 text-[1.6rem] font-semibold tracking-tight text-[#2f2a4e] md:text-[1.9rem]">
                Everything you need to scale AI conversations
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#666184]">
                Purpose-built tools to automate replies, qualify leads, and optimize performance from one dashboard.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {services.map((item, index) => (
              <article
                key={item.title}
                className="group relative overflow-hidden rounded-3xl border border-white/80 bg-gradient-to-br from-white via-[#fcfbff] to-[#f2efff] p-6 text-left shadow-[0_16px_34px_rgba(74,67,119,0.1)] transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_44px_rgba(74,67,119,0.18)]"
              >
                <div className="pointer-events-none absolute right-0 top-0 h-20 w-20 rounded-full bg-[#ddd4ff] blur-2xl transition group-hover:bg-[#cdc1ff]" />
                <div className="relative">
                  <div className="mb-5 flex items-center justify-between">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6d50ff] via-[#5d43eb] to-[#4330bb] shadow-[0_14px_28px_rgba(82,54,216,0.38)] ring-1 ring-white/60">
                      {serviceIcons[index]}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8a84b3]">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight text-[#2f2a4e]">{item.title}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-[#666184]">{item.text}</p>
                </div>
              </article>
            ))}
            </div>
          </section>

          <section className="relative mt-12 overflow-hidden rounded-[30px] border border-white/70 bg-gradient-to-br from-[#f6f3ff] via-[#f9f8ff] to-[#eef4ff] p-6 shadow-[0_24px_55px_rgba(73,57,136,0.18)] md:mt-14 md:p-8">
            <div className="pointer-events-none absolute -left-10 top-0 h-40 w-40 rounded-full bg-[#ddd2ff] blur-3xl" />
            <div className="pointer-events-none absolute -right-8 bottom-1 h-36 w-36 rounded-full bg-[#c6f0f1] blur-3xl" />
            <div className="relative mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <span className="inline-flex rounded-full border border-[#d9d1ff] bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6349de]">
                  Quick Onboarding
                </span>
                <h2 className="mt-3 text-[1.5rem] font-semibold leading-tight text-[#2f2a4e] md:text-[1.7rem]">
                  {setup.title}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#605b82]">{setup.description}</p>
              </div>
              <a
                href="#contact"
                className="inline-flex w-fit items-center rounded-full bg-gradient-to-r from-[#6d50ff] to-[#5236d8] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.08em] text-white no-underline shadow-[0_14px_30px_rgba(82,54,216,0.3)] transition hover:translate-y-[-1px]"
              >
                Start Setup
              </a>
            </div>
            <div className="relative grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {setup.steps.map((step, index) => (
                <article
                  key={step.title}
                  className="group rounded-2xl border border-white/80 bg-white/75 p-4 shadow-[0_14px_28px_rgba(74,67,119,0.08)] backdrop-blur-sm transition hover:-translate-y-1 hover:shadow-[0_18px_34px_rgba(74,67,119,0.16)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#6d50ff] to-[#4f36c9] text-sm font-bold text-white shadow-[0_10px_20px_rgba(82,54,216,0.35)]">
                      {index + 1}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#847fb0]">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-3 text-[15px] font-semibold text-[#2f2a4e]">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-6 text-[#666184]">{step.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-12 grid grid-cols-1 gap-4 md:mt-14 lg:grid-cols-[1fr_1.2fr]" id="blog">
            <article className="rounded-3xl border border-[#ece9fb] bg-gradient-to-br from-white to-[#f8f7ff] p-6 shadow-[0_18px_35px_rgba(74,67,119,0.08)]">
              <h2 className="mb-3 text-[1.44rem] font-semibold leading-tight">{blog.introTitle}</h2>
              <p className="leading-[1.65] text-[#6b6784]">{blog.introText}</p>
            </article>
            <article className="rounded-3xl border border-[#ece9fb] bg-gradient-to-br from-[#f8f9ff] to-[#f3f5ff] p-6 shadow-[0_18px_35px_rgba(74,67,119,0.08)]">
              <h2 className="mb-3 text-[1.44rem] font-semibold leading-tight">{blog.articlesTitle}</h2>
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                {blog.articles.map((item) => (
                  <div
                    className="overflow-hidden rounded-2xl border border-[#efedfc] bg-white shadow-[0_12px_24px_rgba(74,67,119,0.08)]"
                    key={item.title}
                  >
                    <img className="block h-[130px] w-full object-cover" src={item.image} alt={item.title} />
                    <p className="px-3 pb-3.5 pt-3 text-[13px] font-semibold leading-[1.45] text-[#353153]">
                      {item.title}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="mt-12 grid grid-cols-1 gap-4 border-t border-[#ece9fb] pt-10 md:grid-cols-3" id="about">
            {stats.map((stat) => (
              <article
                key={stat.label}
                className="rounded-2xl border border-[#ece9fb] bg-white/90 py-6 text-center shadow-[0_12px_24px_rgba(74,67,119,0.08)]"
              >
                <h3 className="text-3xl font-bold tracking-tight text-[#5339cb]">{stat.value}</h3>
                <p className="mt-2 text-[13px] font-medium text-[#6b6784]">{stat.label}</p>
              </article>
            ))}
          </section>

          <section className="mt-14 rounded-[30px] border border-[#e8e4fc] bg-gradient-to-br from-white via-[#f9f8ff] to-[#f3f6ff] p-6 shadow-[0_20px_45px_rgba(74,67,119,0.1)] md:mt-16 md:p-8">
            <div className="mb-6">
              <span className="inline-flex rounded-full border border-[#ddd5ff] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6047da]">
                {faq.label}
              </span>
              <h2 className="mt-3 text-[1.55rem] font-semibold tracking-tight text-[#2f2a4e] md:text-[1.85rem]">
                {faq.title}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#666184]">{faq.description}</p>
            </div>
            <div className="space-y-3">
              {faq.items.map((item, index) => {
                const isOpen = openFaqIndex === index;
                return (
                  <article
                    key={item.question}
                    className="overflow-hidden rounded-2xl border border-white/80 bg-white/85 shadow-[0_12px_24px_rgba(74,67,119,0.08)]"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? -1 : index)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <span className="text-[15px] font-semibold text-[#2f2a4e]">{item.question}</span>
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#eee9ff] text-lg font-semibold text-[#5c43d7] transition-transform ${
                          isOpen ? "rotate-45" : ""
                        }`}
                      >
                        +
                      </span>
                    </button>
                    <div
                      className={`grid transition-all duration-300 ease-out ${
                        isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="border-t border-[#efebff] px-5 pb-4 pt-3 text-sm leading-7 text-[#666184]">
                        {item.answer}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            id="contact"
            className="mt-14 grid grid-cols-1 gap-8 rounded-[32px] border border-[#e7e3fb] bg-gradient-to-br from-white to-[#f7f5ff] p-7 shadow-[0_22px_45px_rgba(74,67,119,0.1)] md:mt-16 md:grid-cols-[0.95fr_1.05fr] md:p-10"
          >
            <div>
              <span className="inline-flex rounded-full border border-[#ddd5ff] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6047da]">
                Contact Us
              </span>
              <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-[#2f2a4e]">
                {contact.title}
              </h2>
              <p className="mt-3 max-w-md text-sm leading-7 text-[#666184]">{contact.description}</p>
              <div className="mt-7 rounded-2xl border border-[#ece7ff] bg-white/80 p-4 shadow-[0_12px_24px_rgba(74,67,119,0.08)]">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7f78ad]">
                  Contact Details
                </p>
                <div className="mt-4 space-y-3.5">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#efeaff] text-sm text-[#5b40d5]">
                      @
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8b85b2]">Email</p>
                      <p className="text-sm font-medium text-[#3d3761]">{footer.contact.email}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#efeaff] text-sm text-[#5b40d5]">
                      ☏
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8b85b2]">Phone</p>
                      <p className="text-sm font-medium text-[#3d3761]">{footer.contact.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#efeaff] text-sm text-[#5b40d5]">
                      ⌂
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8b85b2]">Address</p>
                      <p className="text-sm font-medium leading-6 text-[#3d3761]">{footer.contact.address}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <form className="grid grid-cols-1 gap-4 rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_18px_36px_rgba(74,67,119,0.12)] backdrop-blur-sm md:grid-cols-2 md:gap-5 md:p-7">
              <input
                className="rounded-xl border border-[#ddd9f5] bg-[#fcfbff] px-4 py-3 text-sm outline-none transition placeholder:text-[#9b96be] focus:border-[#8f7bff] focus:bg-white"
                type="text"
                placeholder={contact.fields.fullName}
              />
              <input
                className="rounded-xl border border-[#ddd9f5] bg-[#fcfbff] px-4 py-3 text-sm outline-none transition placeholder:text-[#9b96be] focus:border-[#8f7bff] focus:bg-white"
                type="email"
                placeholder={contact.fields.workEmail}
              />
              <input
                className="rounded-xl border border-[#ddd9f5] bg-[#fcfbff] px-4 py-3 text-sm outline-none transition placeholder:text-[#9b96be] focus:border-[#8f7bff] focus:bg-white"
                type="text"
                placeholder={contact.fields.companyName}
              />
              <input
                className="rounded-xl border border-[#ddd9f5] bg-[#fcfbff] px-4 py-3 text-sm outline-none transition placeholder:text-[#9b96be] focus:border-[#8f7bff] focus:bg-white"
                type="tel"
                placeholder={contact.fields.phoneNumber}
              />
              <textarea
                className="min-h-[140px] rounded-xl border border-[#ddd9f5] bg-[#fcfbff] px-4 py-3 text-sm outline-none transition placeholder:text-[#9b96be] focus:border-[#8f7bff] focus:bg-white md:col-span-2"
                placeholder={contact.fields.message}
              />
              <button
                type="button"
                className="rounded-full bg-gradient-to-r from-[#6d50ff] to-[#5236d8] px-6 py-3.5 text-sm font-bold uppercase tracking-[0.06em] text-white shadow-[0_16px_34px_rgba(82,54,216,0.34)] transition hover:translate-y-[-1px] md:col-span-2"
              >
                {contact.submitLabel}
              </button>
              <p className="pt-1 text-xs leading-5 text-[#7b76a2] md:col-span-2">{contact.note}</p>
            </form>
          </section>

        </div>
        <footer className="mt-12 w-full border-t border-[#2e2a56] bg-[#171432] text-[#d8d7ef] shadow-[0_20px_40px_rgba(23,20,50,0.35)]">
          <div className="mx-auto w-full max-w-7xl px-6 py-10 md:px-9">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-[1.25fr_2fr]">
              <div>
                <p className="text-xl font-bold text-white">{brand.product}</p>
                <p className="text-xs uppercase tracking-[0.12em] text-[#a9a5cd]">{brand.byline}</p>
                <p className="mt-4 max-w-md text-sm leading-7 text-[#c6c3e3]">{footer.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                {footer.columns.map((column) => (
                  <div key={column.title}>
                    <p className="text-sm font-semibold text-white">{column.title}</p>
                    <div className="mt-3 space-y-2.5">
                      {column.links.map((item) => (
                        <p key={item} className="text-sm text-[#c6c3e3]">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-8 flex flex-col gap-2 border-t border-[#2e2a56] pt-5 text-sm text-[#a9a5cd] md:flex-row md:items-center md:justify-between">
              <p>{footer.copyright}</p>
              <p>{footer.contact.email}</p>
            </div>
          </div>
        </footer>
      </div>
      <style>{`
        @keyframes lpChatArrival {
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

        .lp-chat-arrival {
          animation-name: lpChatArrival;
          animation-duration: 6.5s;
          animation-timing-function: ease;
          animation-iteration-count: infinite;
          opacity: 0;
          will-change: transform, opacity;
        }

        .lp-chat-arrival-1 {
          animation-delay: 0ms;
        }
        .lp-chat-arrival-2 {
          animation-delay: 900ms;
        }
        .lp-chat-arrival-3 {
          animation-delay: 1800ms;
        }
        .lp-chat-arrival-4 {
          animation-delay: 2600ms;
        }
      `}</style>
    </main>
  );
}

export default LandingPage;
