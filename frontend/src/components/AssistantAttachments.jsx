/**
 * Renders product/service materials (images + PDF data URLs) returned with assistant messages.
 */

function openPdfFromDataUrl(dataUrl, filename = "document.pdf") {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return false;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return false;
  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1).replace(/\s/g, "");
  const mimeMatch = /^data:([^;,]+)/i.exec(header);
  const mime = mimeMatch?.[1]?.trim() || "application/pdf";
  let blobUrl = "";
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    blobUrl = URL.createObjectURL(blob);
  } catch {
    return false;
  }
  try {
    const win = window.open(blobUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      const safeName = /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = safeName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } else {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    }
    return true;
  } catch {
    URL.revokeObjectURL(blobUrl);
    return false;
  }
}

export function AssistantAttachments({ attachments, variant = "default" }) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  const wrap =
    variant === "embed"
      ? "mt-2 space-y-2 border-t border-slate-200/80 pt-2"
      : "mt-2 space-y-2 border-t border-[#EEE8FF] pt-2";

  return (
    <div className={wrap}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Attachments</p>
      <div className="flex flex-col gap-2">
        {attachments.map((a, i) => {
          const key = `${a.kind}-${i}-${a.imageName || a.pdfName || ""}`;
          if (a.kind === "image" && typeof a.imageData === "string" && a.imageData.startsWith("data:image/")) {
            return (
              <figure key={key} className="overflow-hidden rounded-lg border border-slate-200/90 bg-slate-50">
                {a.productTitle ? (
                  <figcaption className="truncate border-b border-slate-200/80 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                    {a.productTitle}
                  </figcaption>
                ) : null}
                <img
                  src={a.imageData}
                  alt={a.imageName || "Product"}
                  className="max-h-52 w-full object-contain"
                  loading="lazy"
                />
              </figure>
            );
          }
          if (a.kind === "pdf" && typeof a.pdfData === "string" && /^data:application\/(pdf|x-pdf)/i.test(a.pdfData)) {
            const label = a.pdfName || "PDF";
            return (
              <div key={key} className="rounded-lg border border-slate-200/90 bg-slate-50 px-2 py-2">
                {a.productTitle ? (
                  <p className="mb-1 truncate text-[11px] font-medium text-slate-600">{a.productTitle}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => openPdfFromDataUrl(a.pdfData, label)}
                  className="text-left text-sm font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
                >
                  Open {label}
                </button>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
