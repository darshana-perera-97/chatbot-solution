import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqItems = [
  {
    id: "faq-1",
    question: "How do I install the chatbot on my website?",
    answer:
      "Go to Integrations or Settings, copy the embed script snippet, and paste it before </body> on your site.",
  },
  {
    id: "faq-2",
    question: "Why is my launcher icon not updating?",
    answer:
      "After uploading a new launcher image, save settings and refresh the host page. Use Ctrl+F5 once to clear cached script.",
  },
  {
    id: "faq-3",
    question: "Can I customize chat colors for each account?",
    answer:
      "Yes. In Settings, you can adjust header, sender/receiver bubble colors, and send button color per workspace user.",
  },
  {
    id: "faq-4",
    question: "How do I test the chatbot before going live?",
    answer:
      "Use Test Bot or Live Preview in Settings. Preview mode lets you test styling without triggering real bot replies.",
  },
  {
    id: "faq-5",
    question: "Where can I see user inquiries from chatbot conversations?",
    answer:
      "Open the Inquiries page to view captured user records and related details collected from chatbot flows.",
  },
];

function Support() {
  const [openId, setOpenId] = useState(faqItems[0]?.id || "");

  return (
    <main className="workspace-card">
      <header className="mb-6 max-w-2xl">
        <h1 className="workspace-title">Support</h1>
        <p className="workspace-subtitle">
          Frequently asked questions about setup, customization, and chatbot behavior.
        </p>
      </header>

      <section className="space-y-3">
        {faqItems.map((item) => {
          const isOpen = openId === item.id;
          return (
            <article
              key={item.id}
              className="overflow-hidden rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF]"
            >
              <button
                type="button"
                onClick={() => setOpenId((prev) => (prev === item.id ? "" : item.id))}
                className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
                aria-expanded={isOpen}
              >
                <span className="text-[13px] font-semibold leading-5 text-slate-800 sm:text-sm">{item.question}</span>
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen ? (
                <div className="border-t border-[#EEE8FF] px-4 py-3 text-xs leading-relaxed text-slate-600 sm:text-sm">
                  {item.answer}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}

export default Support;
