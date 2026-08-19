function WorkspacePlaceholder({ title, description }) {
  return (
    <main className="workspace-card">
      <h1 className="workspace-title">{title}</h1>
      <p className="workspace-subtitle max-w-xl">
        {description || "This section is ready for your content."}
      </p>
    </main>
  );
}

export default WorkspacePlaceholder;
