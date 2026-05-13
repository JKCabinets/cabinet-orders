"use client";

import { useState, useEffect, useRef } from "react";
import { Paperclip, Upload, X, Download, FileText, Image, File, Loader2, Trash2 } from "lucide-react";
import clsx from "clsx";

interface Attachment {
  id: number;
  order_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  uploaded_by: string;
  created_at: string;
}

interface AttachmentsPanelProps {
  orderId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: string }) {
  if (type.startsWith("image/")) return <Image className="w-3.5 h-3.5 text-blue-400" />;
  if (type === "application/pdf") return <FileText className="w-3.5 h-3.5 text-red-400" />;
  return <File className="w-3.5 h-3.5 text-[rgba(232,227,218,0.50)]" />;
}

export function AttachmentsPanel({ orderId }: AttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchAttachments() {
      setLoading(true);
      try {
        const res = await fetch(`/api/orders/attachments?orderId=${encodeURIComponent(orderId)}`);
        const data = await res.json();
        if (data.data) setAttachments(data.data);
      } catch {
        setError("Failed to load attachments");
      }
      setLoading(false);
    }
    fetchAttachments();
  }, [orderId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError("");

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("orderId", orderId);

      try {
        const res = await fetch("/api/orders/attachments", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Upload failed");
        } else if (data.data) {
          setAttachments(prev => [data.data, ...prev]);
        }
      } catch {
        setError("Upload failed");
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDownload(attachment: Attachment) {
    setDownloadingId(attachment.id);
    try {
      const res = await fetch(`/api/orders/attachments/${attachment.id}`);
      const data = await res.json();
      if (data.url) {
        const a = document.createElement("a");
        a.href = data.url;
        a.download = attachment.file_name;
        a.target = "_blank";
        a.click();
      }
    } catch {
      setError("Download failed");
    }
    setDownloadingId(null);
  }

  async function handleDelete(id: number) {
    try {
      await fetch(`/api/orders/attachments/${id}`, { method: "DELETE" });
      setAttachments(prev => prev.filter(a => a.id !== id));
      setConfirmDeleteId(null);
    } catch {
      setError("Delete failed");
    }
  }

  return (
    <div className="p-5 border-b border-[rgba(255,255,255,0.10)]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)]">
          Attachments {attachments.length > 0 && <span className="text-[rgba(232,227,218,0.50)]">({attachments.length})</span>}
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all disabled:opacity-50"
        >
          {uploading ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Uploading...</>
          ) : (
            <><Upload className="w-3 h-3" /> Upload</>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleUpload}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
        />
      </div>

      {error && (
        <div className="flex items-center justify-between mb-2 px-2.5 py-1.5 bg-red-950/30 border border-red-900/50 rounded-lg">
          <p className="text-[11px] text-red-400">{error}</p>
          <button onClick={() => setError("")}><X className="w-3 h-3 text-red-400" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[rgba(232,227,218,0.30)]" />
        </div>
      ) : attachments.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border border-dashed border-[rgba(255,255,255,0.10)] rounded-lg py-4 flex flex-col items-center gap-1.5 hover:border-[rgba(86,100,72,0.55)] transition-colors group"
        >
          <Paperclip className="w-4 h-4 text-[rgba(232,227,218,0.30)] group-hover:text-[rgba(232,227,218,0.50)] transition-colors" />
          <span className="text-[11px] text-[rgba(232,227,218,0.30)] group-hover:text-[rgba(232,227,218,0.50)] transition-colors">
            Click to attach files
          </span>
          <span className="text-[10px] text-[#3e3e3e]">PDF, images, docs up to 20MB</span>
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2.5 px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-lg group hover:border-[rgba(86,100,72,0.55)] transition-colors"
            >
              <FileIcon type={att.file_type} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#e8e3da] truncate">{att.file_name}</p>
                <p className="text-[10px] text-[rgba(232,227,218,0.30)]">
                  {formatBytes(att.file_size)} · {att.uploaded_by} · {new Date(att.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {confirmDeleteId === att.id ? (
                  <>
                    <button onClick={() => handleDelete(att.id)} className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded border border-red-900/50 transition-colors">Delete</button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] px-1.5 py-0.5 rounded border border-[rgba(255,255,255,0.10)] transition-colors">Cancel</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleDownload(att)}
                      disabled={downloadingId === att.id}
                      title="Download"
                      className="p-1 text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors"
                    >
                      {downloadingId === att.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(att.id)}
                      title="Delete"
                      className="p-1 text-[rgba(232,227,218,0.50)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
