"use client";

import { useEffect, useRef, useState, type ClipboardEvent } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function MigrationModal({ open, onClose }: Props) {
  const [bucketName, setBucketName] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => firstFieldRef.current?.focus(), 10);
    } else {
      setBucketName("");
      setAccessKeyId("");
      setSecretAccessKey("");
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!bucketName.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) {
      setError("Please fill all fields");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/migrate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketName, accessKeyId, secretAccessKey }),
      });
      const json = await r.json().catch(() => ({} as any));
      if (!r.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "Migration failed");
      }
      const migrated = typeof json?.migrated === "number" ? json.migrated : undefined;
      const message = migrated != null ? `Migrated ${migrated} image${migrated === 1 ? "" : "s"}` : "Migration completed";
      setSuccess(message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const parseEnvAndFill = (text: string) => {
    const lines = text.split(/\r?\n/);
    const env: Record<string, string> = {};
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let value = m[2] || "";
      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }

    const nextAccess = env["AWS_ACCESS_KEY_ID"] || env["TIGRIS_STORAGE_ACCESS_KEY_ID"] || accessKeyId;
    const nextSecret = env["AWS_SECRET_ACCESS_KEY"] || env["TIGRIS_STORAGE_SECRET_ACCESS_KEY"] || secretAccessKey;
    const nextBucket = env["TIGRIS_STORAGE_BUCKET"] || env["AWS_S3_BUCKET"] || env["S3_BUCKET"] || bucketName;

    const changed: string[] = [];
    if (nextAccess && nextAccess !== accessKeyId) {
      setAccessKeyId(nextAccess);
      changed.push("Access key ID");
    }
    if (nextSecret && nextSecret !== secretAccessKey) {
      setSecretAccessKey(nextSecret);
      changed.push("Secret access key");
    }
    if (nextBucket && nextBucket !== bucketName) {
      setBucketName(nextBucket);
      changed.push("Bucket name");
    }

    if (changed.length > 0) {
      setPasteNotice(`Filled: ${changed.join(", ")}`);
      setTimeout(() => setPasteNotice(null), 4000);
      return true;
    }
    return false;
  };

  const handleFormPaste = (e: ClipboardEvent<HTMLFormElement>) => {
    const text = e.clipboardData?.getData("text") || "";
    if (!text) return;
    const looksLikeEnv = /AWS_ACCESS_KEY_ID|TIGRIS_STORAGE_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|TIGRIS_STORAGE_SECRET_ACCESS_KEY|TIGRIS_STORAGE_BUCKET|S3_BUCKET/i.test(text);
    if (!looksLikeEnv) return;
    const filled = parseEnvAndFill(text);
    if (filled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="absolute inset-0 grid place-items-center p-4" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[var(--background)] text-[var(--foreground)] shadow-2xl">
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold">Migrate images to your S3 bucket</h2>
            <button
              aria-label="Close"
              className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <form onSubmit={handleSubmit} onPaste={handleFormPaste} className="p-4 sm:p-5 space-y-4">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 sm:p-4 text-sm text-white/80">
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  Create a bucket on <a href="https://storage.new" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">storage.new</a> if you don't have one.
                </li>
                <li>
                  Create an access key with <span className="font-medium">Read/Write</span> permissions.
                </li>
                <li>
                  Toggle “Environment variables”, copy them, and paste them below.
                </li>
              </ol>
            </div>
            {pasteNotice ? (
              <div className="text-xs text-emerald-400">{pasteNotice}</div>
            ) : null}
            <div className="space-y-2">
              <label className="block text-sm text-white/80">Bucket name</label>
              <input
                ref={firstFieldRef}
                type="text"
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value)}
                placeholder="my-bucket-name"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-white/80">Access key ID</label>
              <input
                type="text"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="AKIA..."
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-white/80">Secret access key</label>
              <input
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 outline-none focus:border-white/25"
              />
            </div>

            {error ? <div className="text-sm text-red-400">{error}</div> : null}
            {success ? <div className="text-sm text-emerald-400">{success}</div> : null}

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                className="h-10 px-4 rounded-full border border-white/15 text-white/80 hover:bg-white/10"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`h-10 px-4 rounded-full bg-white text-black hover:bg-white/90 flex items-center gap-2 ${loading ? "opacity-70 cursor-not-allowed" : ""}`}
                disabled={loading}
              >
                {loading ? "Migrating…" : "Migrate"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}


