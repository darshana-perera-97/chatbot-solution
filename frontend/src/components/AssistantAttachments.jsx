/**
 * Renders chat message materials (images, videos, PDFs, and other files).
 */

function openDataUrlInNewTab(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return false;
  try {
    const win = window.open(dataUrl, "_blank", "noopener,noreferrer");
    return Boolean(win);
  } catch {
    return false;
  }
}

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

function openFileFromDataUrl(dataUrl, filename = "file") {
  if (openDataUrlInNewTab(dataUrl)) return true;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return false;
  try {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

const VARIANT_STYLES = {
  default: {
    wrap: "mt-2 space-y-2 border-t border-[#EEE8FF] pt-2",
    label: "text-slate-400",
    figure: "border-slate-200/90 bg-slate-50",
    caption: "border-slate-200/80 bg-white text-slate-600",
    fileBox: "border-slate-200/90 bg-slate-50",
    fileTitle: "text-slate-600",
    link: "text-violet-700 decoration-violet-300 hover:text-violet-900",
    imageButton: "hover:opacity-95",
  },
  embed: {
    wrap: "mt-2 space-y-2 border-t border-slate-200/80 pt-2",
    label: "text-slate-400",
    figure: "border-slate-200/90 bg-slate-50",
    caption: "border-slate-200/80 bg-white text-slate-600",
    fileBox: "border-slate-200/90 bg-slate-50",
    fileTitle: "text-slate-600",
    link: "text-violet-700 decoration-violet-300 hover:text-violet-900",
    imageButton: "hover:opacity-95",
  },
  customer: {
    wrap: "mt-2 space-y-2 border-t border-white/25 pt-2",
    label: "text-white/70",
    figure: "border-white/30 bg-white/10",
    caption: "border-white/20 bg-white/15 text-white/90",
    fileBox: "border-white/30 bg-white/10",
    fileTitle: "text-white/90",
    link: "text-white underline decoration-white/50 hover:text-white",
    imageButton: "hover:opacity-90",
  },
};

export function AssistantAttachments({ attachments, variant = "default" }) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.default;

  return (
    <div className={styles.wrap}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${styles.label}`}>
        Media
      </p>
      <div className="flex flex-col gap-2">
        {attachments.map((a, i) => {
          const key = `${a.kind}-${i}-${a.imageName || a.pdfName || a.videoName || a.fileName || ""}`;
          if (a.kind === "image" && typeof a.imageData === "string" && a.imageData.startsWith("data:image/")) {
            return (
              <figure key={key} className={`overflow-hidden rounded-lg border ${styles.figure}`}>
                {a.productTitle ? (
                  <figcaption
                    className={`truncate border-b px-2 py-1 text-[11px] font-medium ${styles.caption}`}
                  >
                    {a.productTitle}
                  </figcaption>
                ) : null}
                <button
                  type="button"
                  onClick={() => openDataUrlInNewTab(a.imageData)}
                  className={`block w-full cursor-zoom-in ${styles.imageButton}`}
                  title={a.imageName ? `Open ${a.imageName}` : "Open image"}
                >
                  <img
                    src={a.imageData}
                    alt={a.imageName || "Attachment"}
                    className="max-h-52 w-full object-contain"
                    loading="lazy"
                  />
                </button>
                {a.imageName ? (
                  <p className={`px-2 py-1 text-[10px] ${styles.fileTitle}`}>{a.imageName}</p>
                ) : null}
              </figure>
            );
          }
          if (
            a.kind === "video" &&
            typeof a.videoData === "string" &&
            a.videoData.startsWith("data:video/")
          ) {
            return (
              <figure key={key} className={`overflow-hidden rounded-lg border ${styles.figure}`}>
                <video
                  src={a.videoData}
                  controls
                  className="max-h-52 w-full bg-black object-contain"
                  preload="metadata"
                >
                  <track kind="captions" />
                </video>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <p className={`truncate text-[10px] ${styles.fileTitle}`}>{a.videoName || "Video"}</p>
                  <button
                    type="button"
                    onClick={() => openDataUrlInNewTab(a.videoData)}
                    className={`shrink-0 text-[11px] font-semibold underline underline-offset-2 ${styles.link}`}
                  >
                    Open
                  </button>
                </div>
              </figure>
            );
          }
          if (a.kind === "pdf" && typeof a.pdfData === "string" && /^data:application\/(pdf|x-pdf)/i.test(a.pdfData)) {
            const label = a.pdfName || "PDF";
            return (
              <div key={key} className={`rounded-lg border px-2 py-2 ${styles.fileBox}`}>
                {a.productTitle ? (
                  <p className={`mb-1 truncate text-[11px] font-medium ${styles.fileTitle}`}>
                    {a.productTitle}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => openPdfFromDataUrl(a.pdfData, label)}
                  className={`text-left text-sm font-semibold underline underline-offset-2 ${styles.link}`}
                >
                  Open {label}
                </button>
              </div>
            );
          }
          if (a.kind === "file" && typeof a.fileData === "string" && a.fileData.startsWith("data:")) {
            const label = a.fileName || "File";
            return (
              <div key={key} className={`rounded-lg border px-2 py-2 ${styles.fileBox}`}>
                <button
                  type="button"
                  onClick={() => openFileFromDataUrl(a.fileData, label)}
                  className={`text-left text-sm font-semibold underline underline-offset-2 ${styles.link}`}
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
