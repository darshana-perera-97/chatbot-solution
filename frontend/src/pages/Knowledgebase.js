import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Eye, FileText, Package, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { apiUrl } from "../apiBase";
import { getWorkspaceUserProfile } from "../auth/userSession";

function formatSavedAt(iso) {
  if (typeof iso !== "string" || !iso.trim()) return "Not saved yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not saved yet";
  return d.toLocaleString();
}

const MAX_PDF_BYTES = 8 * 1024 * 1024;

const emptyProduct = () => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: "",
  description: "",
  attachmentKind: "images",
  images: [],
  pdf: null,
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** Decode a PDF data URL and open it in a new tab via blob URL (direct data: links are often blocked). */
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

function Knowledgebase() {
  const location = useLocation();
  const [basicDetails, setBasicDetails] = useState("");
  const [companyDetails, setCompanyDetails] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactWebsite, setContactWebsite] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [agentTargets, setAgentTargets] = useState("");
  const [fieldsToCollectEnabled, setFieldsToCollectEnabled] = useState(false);
  const [fieldsToCollect, setFieldsToCollect] = useState([""]);
  const [otherDetails, setOtherDetails] = useState("");
  const [productsOrServices, setProductsOrServices] = useState([emptyProduct()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [savedOverview, setSavedOverview] = useState({
    updatedAt: "",
    workspaceUserId: "",
    loadedForUserId: "",
  });
  /** "view" = read-only; "edit" = form */
  const [pageMode, setPageMode] = useState("view");

  useEffect(() => {
    let active = true;
    async function loadDetails() {
      setLoading(true);
      setError("");
      try {
        const profile = getWorkspaceUserProfile();
        const userId = profile?.id ? String(profile.id).trim() : "";
        const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
        const res = await fetch(apiUrl(`/agent-details${query}`));
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.message || "Could not load details");
        }
        if (!active) return;
        const details = payload.details || {};
        setSavedOverview({
          updatedAt: typeof details.updatedAt === "string" ? details.updatedAt : "",
          workspaceUserId:
            typeof details.workspaceUserId === "string" ? details.workspaceUserId : userId,
          loadedForUserId: userId,
        });
        setBasicDetails(typeof details.basicDetails === "string" ? details.basicDetails : "");
        setCompanyDetails(typeof details.companyDetails === "string" ? details.companyDetails : "");
        setContactEmail(typeof details.contactEmail === "string" ? details.contactEmail : "");
        setContactPhone(typeof details.contactPhone === "string" ? details.contactPhone : "");
        setContactWebsite(typeof details.contactWebsite === "string" ? details.contactWebsite : "");
        setContactAddress(typeof details.contactAddress === "string" ? details.contactAddress : "");
        setAgentTargets(typeof details.agentTargets === "string" ? details.agentTargets : "");
        setFieldsToCollectEnabled(Boolean(details.fieldsToCollectEnabled));
        const parsedFields = Array.isArray(details.fieldsToCollect)
          ? details.fieldsToCollect
              .map((field) => (typeof field === "string" ? field.trim() : ""))
              .filter((field) => field.length > 0)
          : [];
        setFieldsToCollect(parsedFields.length ? parsedFields : [""]);
        setOtherDetails(typeof details.otherDetails === "string" ? details.otherDetails : "");
        const products = Array.isArray(details.productsOrServices) ? details.productsOrServices : [];
        setProductsOrServices(
          products.length
            ? products.map((product, idx) => {
                const imgs = Array.isArray(product.images)
                  ? product.images
                      .slice(0, 3)
                      .map((image) => ({
                        imageName: typeof image?.imageName === "string" ? image.imageName : "",
                        imageData: typeof image?.imageData === "string" ? image.imageData : "",
                      }))
                      .filter((image) => image.imageData || image.imageName)
                  : typeof product.imageData === "string" || typeof product.imageName === "string"
                  ? [
                      {
                        imageName: typeof product.imageName === "string" ? product.imageName : "",
                        imageData: typeof product.imageData === "string" ? product.imageData : "",
                      },
                    ]
                  : [];
                const pdfData =
                  product.pdf && typeof product.pdf.pdfData === "string" ? product.pdf.pdfData : "";
                const pdfName =
                  product.pdf && typeof product.pdf.pdfName === "string" ? product.pdf.pdfName : "";
                const hasPdf = Boolean(pdfData && pdfName);
                let attachmentKind = product.attachmentKind === "pdf" ? "pdf" : "images";
                if (imgs.length > 0) attachmentKind = "images";
                else if (hasPdf) attachmentKind = "pdf";

                return {
                  id: `${Date.now()}-${idx}`,
                  title: typeof product.title === "string" ? product.title : "",
                  description: typeof product.description === "string" ? product.description : "",
                  attachmentKind,
                  images: attachmentKind === "pdf" ? [] : imgs,
                  pdf:
                    attachmentKind === "pdf" && hasPdf
                      ? { pdfName, pdfData }
                      : null,
                };
              })
            : [emptyProduct()]
        );
        const hasContent =
          [
            details.basicDetails,
            details.companyDetails,
            details.contactEmail,
            details.contactPhone,
            details.contactWebsite,
            details.contactAddress,
            details.agentTargets,
            details.otherDetails,
          ].some((t) => typeof t === "string" && t.trim()) ||
          (Array.isArray(details.productsOrServices) &&
            details.productsOrServices.some(
              (p) =>
                (p && typeof p.title === "string" && p.title.trim()) ||
                (p && typeof p.description === "string" && p.description.trim()) ||
                (Array.isArray(p?.images) && p.images.length > 0) ||
                (p?.pdf && typeof p.pdf.pdfData === "string" && p.pdf.pdfData.trim())
            )) ||
          (Boolean(details.fieldsToCollectEnabled) &&
            Array.isArray(details.fieldsToCollect) &&
            details.fieldsToCollect.some((f) => typeof f === "string" && f.trim()));
        if (active) setPageMode(hasContent ? "view" : "edit");
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load details");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadDetails();
    return () => {
      active = false;
    };
  }, [location.pathname, location.key]);

  const productCountLabel = useMemo(() => `${productsOrServices.length} item(s)`, [productsOrServices.length]);

  const hasMeaningfulContent = useMemo(() => {
    const texts = [
      basicDetails,
      companyDetails,
      contactEmail,
      contactPhone,
      contactWebsite,
      contactAddress,
      agentTargets,
      otherDetails,
    ].some((t) => String(t || "").trim());
    const products = productsOrServices.some(
      (p) =>
        String(p.title || "").trim() ||
        String(p.description || "").trim() ||
        (p.images && p.images.length) ||
        (p.pdf && p.pdf.pdfData)
    );
    const fields =
      fieldsToCollectEnabled &&
      fieldsToCollect.some((f) => String(f || "").trim());
    return texts || products || fields;
  }, [
    basicDetails,
    companyDetails,
    contactEmail,
    contactPhone,
    contactWebsite,
    contactAddress,
    agentTargets,
    otherDetails,
    productsOrServices,
    fieldsToCollectEnabled,
    fieldsToCollect,
  ]);

  const updateProduct = (id, patch) => {
    setProductsOrServices((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const onAddProduct = () => {
    setProductsOrServices((current) => [...current, emptyProduct()]);
  };

  const onRemoveProduct = (id) => {
    setProductsOrServices((current) => {
      const next = current.filter((item) => item.id !== id);
      return next.length ? next : [emptyProduct()];
    });
  };

  const onRemoveProductImage = (productId, imageIndex) => {
    setProductsOrServices((current) =>
      current.map((item) => {
        if (item.id !== productId) return item;
        const images = Array.isArray(item.images) ? item.images : [];
        return { ...item, images: images.filter((_, idx) => idx !== imageIndex) };
      })
    );
    setStatusMessage("");
    setError("");
  };

  const setProductAttachmentKind = (id, kind) => {
    setProductsOrServices((current) => {
      const item = current.find((p) => p.id === id);
      if (!item || item.attachmentKind === kind) return current;
      const imgs = Array.isArray(item.images) ? item.images : [];
      const hasPdf = Boolean(item.pdf?.pdfData);
      if (kind === "pdf" && imgs.length > 0) {
        if (!window.confirm("Switch to a single PDF? Images on this card will be removed.")) return current;
      } else if (kind === "images" && hasPdf) {
        if (!window.confirm("Switch to images? The PDF on this card will be removed.")) return current;
      }
      return current.map((p) => {
        if (p.id !== id) return p;
        if (kind === "pdf") {
          return { ...p, attachmentKind: "pdf", images: [], pdf: p.pdf };
        }
        return { ...p, attachmentKind: "images", pdf: null, images: p.images };
      });
    });
    setError("");
  };

  const onRemovePdf = (id) => {
    updateProduct(id, { pdf: null });
    setStatusMessage("");
    setError("");
  };

  const onUploadPdf = async (id, files) => {
    const file = files && files[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError("PDF must be 8 MB or smaller.");
      return;
    }
    try {
      const pdfData = await readFileAsDataUrl(file);
      updateProduct(id, {
        attachmentKind: "pdf",
        images: [],
        pdf: { pdfName: file.name, pdfData },
      });
      setStatusMessage("PDF attached to product card.");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read PDF");
    }
  };

  const onUploadImage = async (id, files) => {
    if (!files || files.length === 0) return;
    const target = productsOrServices.find((item) => item.id === id);
    if (target?.attachmentKind === "pdf") {
      setError('Switch "Attachment type" to Images, or remove the PDF, to add pictures.');
      return;
    }
    const currentCount = Array.isArray(target?.images) ? target.images.length : 0;
    if (currentCount >= 3) {
      setError("Maximum 3 images allowed per card.");
      return;
    }
    const allowedCount = Math.min(3 - currentCount, files.length);
    const selectedFiles = Array.from(files).slice(0, allowedCount);
    try {
      const newImages = await Promise.all(
        selectedFiles.map(async (file) => ({
          imageData: await readFileAsDataUrl(file),
          imageName: file.name,
        }))
      );
      updateProduct(id, {
        images: [...(Array.isArray(target?.images) ? target.images : []), ...newImages],
      });
      setStatusMessage("Image(s) attached to product card.");
      setError("");
      if (files.length > allowedCount) {
        setStatusMessage("Only first 3 images are allowed per card.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload image");
    }
  };

  const onSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      const profile = getWorkspaceUserProfile();
      const userId = profile?.id ? String(profile.id).trim() : "";
      const payload = {
        ...(userId ? { userId } : {}),
        basicDetails,
        companyDetails,
        contactEmail,
        contactPhone,
        contactWebsite,
        contactAddress,
        productsOrServices: productsOrServices.map((item) => {
          const attachmentKind = item.attachmentKind === "pdf" ? "pdf" : "images";
          if (attachmentKind === "pdf") {
            return {
              title: item.title,
              description: item.description,
              attachmentKind: "pdf",
              images: [],
              pdf:
                item.pdf?.pdfData && item.pdf?.pdfName
                  ? { pdfName: item.pdf.pdfName, pdfData: item.pdf.pdfData }
                  : null,
            };
          }
          return {
            title: item.title,
            description: item.description,
            attachmentKind: "images",
            images: Array.isArray(item.images) ? item.images.slice(0, 3) : [],
            pdf: null,
          };
        }),
        agentTargets,
        fieldsToCollectEnabled,
        fieldsToCollect: fieldsToCollectEnabled
          ? fieldsToCollect
              .map((field) => field.trim())
              .filter((field) => field.length > 0)
          : [],
        otherDetails,
      };
      const res = await fetch(apiUrl("/agent-details"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(saved.message || "Could not save agent details");
      }
      const d = saved.details || {};
      setSavedOverview({
        updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
        workspaceUserId: typeof d.workspaceUserId === "string" ? d.workspaceUserId : userId,
        loadedForUserId: userId,
      });
      setStatusMessage("Agent details saved successfully.");
      setPageMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save agent details");
    } finally {
      setSaving(false);
    }
  };

  const onAddFieldToCollect = () => {
    setFieldsToCollect((current) => [...current, ""]);
  };

  const onRemoveFieldToCollect = (index) => {
    setFieldsToCollect((current) => current.filter((_, idx) => idx !== index));
  };

  const onFieldToCollectChange = (index, value) => {
    setFieldsToCollect((current) => current.map((item, idx) => (idx === index ? value : item)));
  };

  const modeToggle = (
    <div
      className="inline-flex rounded-xl border border-[#E9DFFF] bg-[#FDFCFF] p-1 shadow-sm"
      role="group"
      aria-label="View or edit knowledgebase"
    >
      <button
        type="button"
        onClick={() => setPageMode("view")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
          pageMode === "view"
            ? "bg-white text-[#6D28D9] shadow-sm"
            : "text-slate-500 hover:text-slate-700"
        }`}
      >
        <Eye size={14} aria-hidden />
        View
      </button>
      <button
        type="button"
        onClick={() => setPageMode("edit")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
          pageMode === "edit"
            ? "bg-white text-[#6D28D9] shadow-sm"
            : "text-slate-500 hover:text-slate-700"
        }`}
      >
        <Pencil size={14} aria-hidden />
        Edit
      </button>
    </div>
  );

  const metaBar = (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#EEE8FF] bg-[#FAF7FF] px-4 py-3 text-xs text-slate-600">
      <p>
        <span className="font-semibold text-slate-700">Storage:</span>{" "}
        <code className="rounded bg-white px-1.5 py-0.5 text-[11px] text-[#5B21B6]">backend/data/</code>
      </p>
      <div className="text-right">
        <p>
          <span className="font-semibold text-slate-700">Last saved:</span> {formatSavedAt(savedOverview.updatedAt)}
        </p>
        {savedOverview.loadedForUserId || savedOverview.workspaceUserId ? (
          <p className="mt-1">
            <span className="font-semibold text-slate-700">Workspace user id:</span>{" "}
            <code className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-800">
              {savedOverview.workspaceUserId || savedOverview.loadedForUserId}
            </code>
          </p>
        ) : (
          <p className="mt-1 text-amber-800">Shared default file (no user id in session).</p>
        )}
      </div>
    </div>
  );

  return (
    <main className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-[#F0E9FF] bg-white p-6 shadow-[0_18px_50px_rgba(139,92,246,0.08)] xl:min-h-0">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Knowledgebase</h1>
          <p className="mt-2 text-sm text-slate-400">
            {pageMode === "view"
              ? "Review what is stored for your chatbot. Switch to Edit to change it."
              : "Update fields below, then save. Switch to View to read without editing."}
          </p>
        </div>
        {loading ? null : modeToggle}
      </header>

      {loading ? (
        <div className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-6 text-sm text-slate-500">
          Loading existing details...
        </div>
      ) : pageMode === "view" ? (
        <div className="space-y-5">
          {metaBar}

          {!hasMeaningfulContent ? (
            <div className="rounded-2xl border border-dashed border-[#DDD6FE] bg-[#FDFCFF] p-8 text-center">
              <p className="text-sm text-slate-600">No knowledgebase content yet.</p>
              <button
                type="button"
                onClick={() => setPageMode("edit")}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30"
              >
                <Pencil size={15} />
                Go to Edit
              </button>
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
                <h2 className="text-sm font-semibold text-slate-800">Agent basic details and role</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {basicDetails.trim() ? basicDetails : "—"}
                </p>
              </section>

              <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
                <h2 className="text-sm font-semibold text-slate-800">Company / Institute details</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {companyDetails.trim() ? companyDetails : "—"}
                </p>
              </section>

              <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
                <h2 className="text-sm font-semibold text-slate-800">Contact details</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Email, phone, website, and address your chatbot can reference for visitors.
                </p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-lg border border-[#EEE8FF] bg-white px-3 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Email</dt>
                    <dd className="mt-1 text-slate-800">{contactEmail.trim() ? contactEmail : "—"}</dd>
                  </div>
                  <div className="rounded-lg border border-[#EEE8FF] bg-white px-3 py-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Phone</dt>
                    <dd className="mt-1 text-slate-800">{contactPhone.trim() ? contactPhone : "—"}</dd>
                  </div>
                  <div className="rounded-lg border border-[#EEE8FF] bg-white px-3 py-2 sm:col-span-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Website</dt>
                    <dd className="mt-1 break-all text-slate-800">{contactWebsite.trim() ? contactWebsite : "—"}</dd>
                  </div>
                  <div className="rounded-lg border border-[#EEE8FF] bg-white px-3 py-2 sm:col-span-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Address</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-slate-800">
                      {contactAddress.trim() ? contactAddress : "—"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
                <h2 className="text-sm font-semibold text-slate-800">Products or services</h2>
                <p className="mt-1 text-xs text-slate-400">{productCountLabel}</p>
                <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {productsOrServices.map((item, index) => {
                    const imgs = Array.isArray(item.images) ? item.images : [];
                    const isPdfCard = item.attachmentKind === "pdf" && item.pdf?.pdfData;
                    const titleText = String(item.title || "").trim() || `Item ${index + 1}`;
                    const hasDesc = Boolean(String(item.description || "").trim());
                    return (
                      <article
                        key={item.id || `view-p-${index}`}
                        className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#E8DEFF] bg-white shadow-[0_12px_40px_rgba(139,92,246,0.08)] ring-1 ring-black/[0.02] transition duration-200 hover:-translate-y-0.5 hover:border-[#C4B5FD] hover:shadow-[0_18px_50px_rgba(139,92,246,0.14)]"
                      >
                        <div className="relative shrink-0 bg-[#F5F3FF]">
                          {isPdfCard ? (
                            <div className="relative flex aspect-[4/3] min-h-[168px] max-h-52 w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#EDE9FE] via-white to-[#FFEDD5] px-4">
                              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-[#DDD6FE]">
                                <FileText size={28} className="text-[#8B5CF6]" strokeWidth={1.5} />
                              </div>
                              <p className="max-w-full truncate text-center text-xs font-semibold text-slate-800">
                                {item.pdf.pdfName || "Document.pdf"}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  openPdfFromDataUrl(
                                    item.pdf.pdfData,
                                    item.pdf.pdfName || "document.pdf"
                                  )
                                }
                                className="rounded-lg bg-[#8B5CF6] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-95"
                              >
                                Open PDF
                              </button>
                              <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                                PDF
                              </span>
                            </div>
                          ) : imgs.length > 0 ? (
                            <>
                              {imgs.length === 1 ? (
                                <div className="aspect-[4/3] w-full min-h-[168px] max-h-52">
                                  <img
                                    src={imgs[0].imageData}
                                    alt={imgs[0].imageName || titleText}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              ) : imgs.length === 2 ? (
                                <div className="grid aspect-[4/3] min-h-[168px] max-h-52 w-full grid-cols-2 gap-px bg-[#E9D5FF]">
                                  {imgs.slice(0, 2).map((image, imageIndex) => (
                                    <img
                                      key={`${item.id}-v-${imageIndex}`}
                                      src={image.imageData}
                                      alt={image.imageName || titleText}
                                      className="h-full min-h-0 w-full object-cover"
                                    />
                                  ))}
                                </div>
                              ) : (
                                <div className="grid aspect-[4/3] min-h-[168px] max-h-52 w-full grid-cols-3 grid-rows-2 gap-px bg-[#E9D5FF]">
                                  <img
                                    src={imgs[0].imageData}
                                    alt={imgs[0].imageName || titleText}
                                    className="col-span-2 row-span-2 h-full min-h-0 w-full object-cover"
                                  />
                                  <img
                                    src={imgs[1].imageData}
                                    alt={imgs[1].imageName || titleText}
                                    className="col-start-3 row-start-1 h-full min-h-0 w-full object-cover"
                                  />
                                  <img
                                    src={imgs[2].imageData}
                                    alt={imgs[2].imageName || titleText}
                                    className="col-start-3 row-start-2 h-full min-h-0 w-full object-cover"
                                  />
                                </div>
                              )}
                              <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                                {imgs.length} photo{imgs.length !== 1 ? "s" : ""}
                              </span>
                            </>
                          ) : (
                            <div className="flex aspect-[4/3] min-h-[168px] max-h-52 w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#EDE9FE] via-white to-[#FFEDD5]">
                              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-[#DDD6FE]">
                                <Package size={26} className="text-[#8B5CF6]" strokeWidth={1.5} />
                              </div>
                              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                                No images or PDF
                              </span>
                            </div>
                          )}
                          <span className="absolute left-2.5 top-2.5 rounded-lg bg-white/95 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#5B21B6] shadow-sm ring-1 ring-[#EDE9FE]">
                            {index + 1}
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col border-t border-[#F0E9FF] p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B5CF6]">
                            Product / service
                          </p>
                          <h3 className="mt-1 text-base font-semibold leading-snug tracking-tight text-slate-900">
                            {titleText}
                          </h3>
                          <p
                            className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 ${
                              hasDesc ? "min-h-[4.5rem]" : "italic text-slate-400"
                            }`}
                          >
                            {hasDesc ? item.description : "No description added."}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
                <h2 className="text-sm font-semibold text-slate-800">Agent targets</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {agentTargets.trim() ? agentTargets : "—"}
                </p>
              </section>

              <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
                <h2 className="text-sm font-semibold text-slate-800">Fields to collect</h2>
                <p className="mt-2 text-sm text-slate-700">
                  {fieldsToCollectEnabled ? (
                    <>
                      <span className="font-medium text-emerald-700">Enabled</span>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
                        {fieldsToCollect
                          .map((f) => String(f || "").trim())
                          .filter(Boolean)
                          .map((f, idx) => (
                            <li key={`${idx}-${f}`}>{f}</li>
                          ))}
                      </ul>
                      {!fieldsToCollect.some((f) => String(f || "").trim()) ? (
                        <p className="text-slate-500">No field labels configured.</p>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-slate-500">Disabled</span>
                  )}
                </p>
              </section>

              <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
                <h2 className="text-sm font-semibold text-slate-800">Other details</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {otherDetails.trim() ? otherDetails : "—"}
                </p>
              </section>
            </>
          )}

          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          {statusMessage ? <p className="text-sm font-medium text-emerald-700">{statusMessage}</p> : null}
        </div>
      ) : (
        <form onSubmit={onSave} className="space-y-5">
          {metaBar}

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Agent basic details and role
            </label>
            <textarea
              value={basicDetails}
              onChange={(e) => setBasicDetails(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
              placeholder="Describe your chatbot role, personality, and core behavior."
            />
          </section>

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              Company/Institute Details
            </label>
            <textarea
              value={companyDetails}
              onChange={(e) => setCompanyDetails(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
              placeholder="Share company background, mission, audience, and important context."
            />
          </section>

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
            <p className="text-sm font-semibold text-slate-700">Contact details</p>
            <p className="mt-1 text-xs text-slate-400">
              Email, phone, website, and address visitors can use to reach you. The chatbot will only mention what you
              save here.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-lg border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                  placeholder="hello@company.com"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Phone</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full rounded-lg border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                  placeholder="+1 …"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-600">Website</span>
                <input
                  type="url"
                  autoComplete="url"
                  value={contactWebsite}
                  onChange={(e) => setContactWebsite(e.target.value)}
                  className="w-full rounded-lg border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                  placeholder="https://"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-600">Address</span>
                <textarea
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                  placeholder="Street, city, region, postal code"
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-700">Products or services</p>
                <p className="text-xs text-slate-400">{productCountLabel}</p>
              </div>
              <button
                type="button"
                onClick={onAddProduct}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#8B5CF6] px-3 py-2 text-xs font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95"
              >
                <Plus size={14} />
                Add card
              </button>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {productsOrServices.map((item, index) => {
                const imgs = Array.isArray(item.images) ? item.images : [];
                const usePdf = item.attachmentKind === "pdf";
                return (
                  <article
                    key={item.id}
                    className="flex flex-col overflow-hidden rounded-2xl border border-[#E8DEFF] bg-white shadow-[0_12px_40px_rgba(139,92,246,0.06)] ring-1 ring-black/[0.02]"
                  >
                    <div className="relative shrink-0 bg-[#F5F3FF]">
                      {usePdf ? (
                        item.pdf?.pdfData ? (
                          <div className="relative flex aspect-[4/3] min-h-[120px] max-h-40 w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#EDE9FE] via-white to-[#FFEDD5] px-3">
                            <FileText size={26} className="text-[#8B5CF6]" strokeWidth={1.5} />
                            <p className="max-w-full truncate px-2 text-center text-[11px] font-semibold text-slate-800">
                              {item.pdf.pdfName}
                            </p>
                            <button
                              type="button"
                              onClick={() => onRemovePdf(item.id)}
                              className="rounded-lg bg-slate-900/85 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-red-600"
                            >
                              Remove PDF
                            </button>
                            <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                              PDF
                            </span>
                          </div>
                        ) : (
                          <div className="flex aspect-[4/3] min-h-[120px] max-h-40 w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-[#EDE9FE] via-white to-[#FFEDD5] px-2">
                            <FileText size={22} className="text-[#A78BFA]" strokeWidth={1.5} />
                            <span className="px-2 text-center text-[10px] font-medium text-slate-500">
                              Single PDF — choose file below (max 8 MB)
                            </span>
                          </div>
                        )
                      ) : imgs.length > 0 ? (
                        <>
                          {imgs.length === 1 ? (
                            <div className="relative aspect-[4/3] w-full min-h-[120px] max-h-40">
                              <img
                                src={imgs[0].imageData}
                                alt={imgs[0].imageName || item.title || "Product"}
                                className="h-full w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => onRemoveProductImage(item.id, 0)}
                                className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/75 text-white shadow-sm ring-1 ring-white/30 transition hover:bg-red-600"
                                aria-label="Remove this image"
                                title="Remove image"
                              >
                                <X size={14} strokeWidth={2.5} aria-hidden />
                              </button>
                            </div>
                          ) : imgs.length === 2 ? (
                            <div className="grid aspect-[4/3] min-h-[120px] max-h-40 w-full grid-cols-2 gap-px bg-[#E9D5FF]">
                              {imgs.slice(0, 2).map((image, imageIndex) => (
                                <div key={`${item.id}-e-${imageIndex}`} className="relative min-h-0">
                                  <img
                                    src={image.imageData}
                                    alt={image.imageName || item.title || "Product"}
                                    className="h-full min-h-[120px] w-full object-cover"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => onRemoveProductImage(item.id, imageIndex)}
                                    className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/75 text-white shadow-sm ring-1 ring-white/30 transition hover:bg-red-600"
                                    aria-label={`Remove image ${imageIndex + 1}`}
                                    title="Remove image"
                                  >
                                    <X size={14} strokeWidth={2.5} aria-hidden />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="grid aspect-[4/3] min-h-[120px] max-h-40 w-full grid-cols-3 grid-rows-2 gap-px bg-[#E9D5FF]">
                              <div className="relative col-span-2 row-span-2 min-h-0">
                                <img
                                  src={imgs[0].imageData}
                                  alt={imgs[0].imageName || item.title || "Product"}
                                  className="h-full min-h-0 w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => onRemoveProductImage(item.id, 0)}
                                  className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/75 text-white shadow-sm ring-1 ring-white/30 transition hover:bg-red-600"
                                  aria-label="Remove image 1"
                                  title="Remove image"
                                >
                                  <X size={14} strokeWidth={2.5} aria-hidden />
                                </button>
                              </div>
                              <div className="relative col-start-3 row-start-1 min-h-0">
                                <img
                                  src={imgs[1].imageData}
                                  alt={imgs[1].imageName || item.title || "Product"}
                                  className="h-full min-h-0 w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => onRemoveProductImage(item.id, 1)}
                                  className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/75 text-white shadow-sm ring-1 ring-white/30 transition hover:bg-red-600"
                                  aria-label="Remove image 2"
                                  title="Remove image"
                                >
                                  <X size={14} strokeWidth={2.5} aria-hidden />
                                </button>
                              </div>
                              <div className="relative col-start-3 row-start-2 min-h-0">
                                <img
                                  src={imgs[2].imageData}
                                  alt={imgs[2].imageName || item.title || "Product"}
                                  className="h-full min-h-0 w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => onRemoveProductImage(item.id, 2)}
                                  className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/75 text-white shadow-sm ring-1 ring-white/30 transition hover:bg-red-600"
                                  aria-label="Remove image 3"
                                  title="Remove image"
                                >
                                  <X size={14} strokeWidth={2.5} aria-hidden />
                                </button>
                              </div>
                            </div>
                          )}
                          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                            {imgs.length}/3
                          </span>
                        </>
                      ) : (
                        <div className="flex aspect-[4/3] min-h-[120px] max-h-40 w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-[#EDE9FE] via-white to-[#FFEDD5]">
                          <Package size={22} className="text-[#A78BFA]" strokeWidth={1.5} />
                          <span className="px-2 text-center text-[10px] font-medium text-slate-500">
                            Add up to 3 images
                          </span>
                        </div>
                      )}
                      <span className="absolute left-2 top-2 rounded-lg bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#5B21B6] shadow-sm ring-1 ring-[#EDE9FE]">
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveProduct(item.id)}
                        className="absolute right-2 top-2 rounded-lg bg-white/95 p-1.5 text-slate-500 shadow-sm ring-1 ring-[#EDE9FE] transition hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove product card ${index + 1}`}
                        title="Remove card"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 border-t border-[#F0E9FF] p-3">
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) => updateProduct(item.id, { title: e.target.value })}
                        placeholder="Product or service name"
                        className="w-full rounded-lg border border-[#E9DFFF] bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                      />
                      <textarea
                        value={item.description}
                        onChange={(e) => updateProduct(item.id, { description: e.target.value })}
                        rows={3}
                        placeholder="Short description for the chatbot"
                        className="w-full resize-y rounded-lg border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                      />
                      <div className="rounded-lg border border-[#EDE9FE] bg-[#FAF7FF] px-3 py-2.5">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Attachment type
                        </p>
                        <div
                          className="inline-flex rounded-lg border border-[#E9DFFF] bg-white p-0.5"
                          role="group"
                          aria-label="Images or single PDF"
                        >
                          <button
                            type="button"
                            onClick={() => setProductAttachmentKind(item.id, "images")}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                              !usePdf
                                ? "bg-[#8B5CF6] text-white shadow-sm"
                                : "text-slate-600 hover:bg-[#FAF7FF]"
                            }`}
                          >
                            Images (max 3)
                          </button>
                          <button
                            type="button"
                            onClick={() => setProductAttachmentKind(item.id, "pdf")}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                              usePdf
                                ? "bg-[#8B5CF6] text-white shadow-sm"
                                : "text-slate-600 hover:bg-[#FAF7FF]"
                            }`}
                          >
                            Single PDF
                          </button>
                        </div>
                      </div>
                      {usePdf ? (
                        item.pdf?.pdfData ? (
                          <div className="space-y-2 rounded-lg border border-[#EDE9FE] bg-[#FAF7FF] px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              PDF on this card
                            </p>
                            <div className="flex items-center gap-2 rounded-lg border border-[#E9DFFF] bg-white px-3 py-2">
                              <FileText size={18} className="shrink-0 text-[#8B5CF6]" aria-hidden />
                              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">
                                {item.pdf.pdfName}
                              </span>
                              <button
                                type="button"
                                onClick={() => onRemovePdf(item.id)}
                                className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                                aria-label="Remove PDF"
                                title="Remove PDF"
                              >
                                <X size={14} aria-hidden />
                              </button>
                            </div>
                          </div>
                        ) : null
                      ) : imgs.length > 0 ? (
                        <div className="space-y-2 rounded-lg border border-[#EDE9FE] bg-[#FAF7FF] px-3 py-2.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Images on this card ({imgs.length}/3)
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {imgs.map((image, thumbIndex) => (
                              <div
                                key={`${item.id}-below-${thumbIndex}`}
                                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[#E9DFFF] bg-white shadow-sm"
                              >
                                <img
                                  src={image.imageData}
                                  alt={image.imageName || item.title || `Image ${thumbIndex + 1}`}
                                  className="h-full w-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => onRemoveProductImage(item.id, thumbIndex)}
                                  className="absolute bottom-0.5 right-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-slate-900/80 text-white shadow-sm ring-1 ring-white/25 transition hover:bg-red-600"
                                  aria-label={`Remove image ${thumbIndex + 1}`}
                                  title="Remove image"
                                >
                                  <X size={12} strokeWidth={2.5} aria-hidden />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {usePdf ? (
                        <label className="block cursor-pointer space-y-1">
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Add or replace PDF
                          </span>
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            onChange={(e) => {
                              onUploadPdf(item.id, e.target.files);
                              e.target.value = "";
                            }}
                            className="block w-full text-[11px] text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-[#F3ECFF] file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-[#6D28D9]"
                          />
                        </label>
                      ) : (
                        <label className="block cursor-pointer space-y-1">
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Add or replace images
                          </span>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(e) => onUploadImage(item.id, e.target.files)}
                            className="block w-full text-[11px] text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-[#F3ECFF] file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-[#6D28D9]"
                          />
                        </label>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Agent Targets</label>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <textarea
                  value={agentTargets}
                  onChange={(e) => setAgentTargets(e.target.value)}
                  rows={8}
                  className="w-full rounded-xl border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                  placeholder="Add goals, KPIs, conversion targets, support outcomes, etc."
                />
              </div>
              <div className="rounded-xl border border-[#EDE3FF] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Fields to collect</p>
                  <p className="text-xs text-slate-400">
                    Enable this to define what chatbot should ask users.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={fieldsToCollectEnabled}
                  onClick={() => setFieldsToCollectEnabled((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                    fieldsToCollectEnabled ? "bg-[#8B5CF6]" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      fieldsToCollectEnabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {fieldsToCollectEnabled ? (
                <div className="mt-4 space-y-2">
                  {fieldsToCollect.map((field, index) => (
                    <div key={`collect-field-${index}`} className="flex gap-2">
                      <input
                        type="text"
                        value={field}
                        onChange={(e) => onFieldToCollectChange(index, e.target.value)}
                        placeholder={`Field ${index + 1} (e.g. Name, Email, Phone)`}
                        className="min-w-0 flex-1 rounded-lg border border-[#E9DFFF] px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveFieldToCollect(index)}
                        className="shrink-0 rounded-lg border border-[#E9DFFF] bg-white p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove field ${index + 1}`}
                        title="Remove field"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={onAddFieldToCollect}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#F3ECFF] px-3 py-1.5 text-xs font-semibold text-[#6D28D9]"
                  >
                    <Plus size={13} />
                    Add field
                  </button>
                </div>
              ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#EEE8FF] bg-[#FDFCFF] p-5">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Other Details</label>
            <textarea
              value={otherDetails}
              onChange={(e) => setOtherDetails(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-[#E9DFFF] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20"
              placeholder="Any additional notes, restrictions, links, or instructions."
            />
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#8B5CF6]/30 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={15} />
              {saving ? "Saving..." : "Save details"}
            </button>
            <button
              type="button"
              onClick={() => setPageMode("view")}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E9DFFF] bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#FAF7FF]"
            >
              <Eye size={15} />
              View only
            </button>
            {statusMessage ? <p className="text-sm font-medium text-emerald-700">{statusMessage}</p> : null}
            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          </div>
        </form>
      )}
    </main>
  );
}

export default Knowledgebase;
