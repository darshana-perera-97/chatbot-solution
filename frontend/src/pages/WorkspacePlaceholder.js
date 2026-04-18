function WorkspacePlaceholder({ title, description }) {
  return (
    <main className="rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)]">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 max-w-xl text-sm text-slate-400">
        {description || "This section is ready for your content."}
      </p>
    </main>
  );
}

export default WorkspacePlaceholder;
