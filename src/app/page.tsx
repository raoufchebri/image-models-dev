"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { ProgressiveImage } from "@/app/components/ProgressiveImage";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  imageUrl?: string;
  variants?: { label: string; imageUrl?: string; text?: string; vote?: "up" | "down"; durationMs?: number; tokens?: number }[];
};

type ModelResponse = {
  image?: string;
  url?: string;
  text?: string;
  success?: boolean;
  tokens?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const composerVisible = hasRun || transitioning;
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedModels, setSelectedModels] = useState<{ gemini: boolean; flux: boolean; imageGpt: boolean }>({ gemini: true, flux: true, imageGpt: true });
  const { isSignedIn } = useAuth();
  const { redirectToSignIn } = useClerk();

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const container = chatScrollRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior, block: "end" });
    }
  };

  const selectedEntries = Object.entries(selectedModels).filter(([, v]) => v) as Array<
    ["gemini" | "flux" | "imageGpt", boolean]
  >;
  const selectedLabels = selectedEntries
    .map(([k]) => (k === "gemini" ? "Gemini" : k === "flux" ? "Flux-1" : "Image-GPT"))
    .filter((label) => label !== "Flux-1");

  const handleVote = (messageId: string, label: string, vote: "up" | "down") => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m;
      const nextVariants = (m.variants || []).map((v) => {
        if (v.label !== label) return v;
        const nextVote = v.vote === vote ? undefined : vote;
        return { ...v, vote: nextVote };
      });
      return { ...m, variants: nextVariants };
    }));
  };

  useEffect(() => {
    if (!hasRun) return;
    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
    const t = setTimeout(() => scrollToBottom("smooth"), 80);
    return () => clearTimeout(t);
  }, [messages, loading, hasRun]);

  useEffect(() => {
    if (!zoomUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomUrl]);

  // Restore pending prompt after returning from sign-in
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pendingPrompt");
      if (saved) {
        setPrompt(saved);
        localStorage.removeItem("pendingPrompt");
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim()) return;
    if (!isSignedIn) {
      try {
        localStorage.setItem("pendingPrompt", prompt);
      } catch {
        // ignore
      }
      redirectToSignIn({ afterSignInUrl: typeof window !== "undefined" ? window.location.href : "/" });
      return;
    }
    setLoading(true);
    setShowLoadingSkeleton(true);
    setError(null);
    if (!hasRun) {
      setTransitioning(true);
      setTimeout(() => {
        setHasRun(true);
        setTransitioning(false);
      }, 250); // sync with fade-out duration
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    setMessages((prev) => [...prev, userMessage]);
    setPrompt("");
    requestAnimationFrame(() => scrollToBottom("auto"));

    try {
      if (selectedEntries.length === 0) {
        setLoading(false);
        setError("Select at least one model");
        return;
      }

      const payload: Record<string, unknown> = { prompt: userMessage.content };
      if (uploadedImage) {
        payload.image = uploadedImage;
      }
      const fetchParams = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      } as const;

      const geminiPromise: Promise<ModelResponse> = fetch("/api/gemini-image-flash", {
        ...fetchParams,
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text().catch(() => "Gemini request failed"));
        return r.json() as Promise<ModelResponse>;
      });
      // Flux disabled for now
      const imageGptPromise: Promise<ModelResponse> = fetch("/api/image-gpt", {
        ...fetchParams,
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text().catch(() => "Image-GPT request failed"));
        return r.json() as Promise<ModelResponse>;
      });

      const fluxPromise: Promise<ModelResponse> = fetch("/api/flux-1", {
        ...fetchParams,
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text().catch(() => "Flux-1 request failed"));
        return r.json() as Promise<ModelResponse>;
      });

      const tasks: { label: string; promise: Promise<ModelResponse> }[] = [];
      if (selectedModels.imageGpt) tasks.push({ label: "Image-GPT", promise: imageGptPromise });
      if (selectedModels.gemini) tasks.push({ label: "Gemini", promise: geminiPromise });
      if (selectedModels.flux) tasks.push({ label: "Flux-1", promise: fluxPromise });

      const initialVariants = tasks.map((t) => ({ label: t.label }));
      const startTimes: Record<string, number> = {};
      tasks.forEach((t) => { startTimes[t.label] = performance.now(); });
      const assistantId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantId,  
        role: "assistant",
        content: undefined,
        variants: initialVariants,
      };
      // Show assistant message immediately and switch to per-variant placeholders only
      setShowLoadingSkeleton(false);
      setMessages((prev) => [...prev, assistantMessage]);

      // Update each variant as its promise resolves
      tasks.forEach((t) => {
        t.promise
          .then((value) => {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== assistantId) return m;
              const text = typeof value?.text === "string" && value.text.trim().length > 0 ? value.text : undefined;
              const nextVariants = (m.variants || []).map((v) => {
                if (v.label !== t.label) return v;
                const imageUrl = typeof value?.image === "string" ? value.image : (typeof value?.url === "string" ? value.url : undefined);
                const durationMs = Math.round(performance.now() - (startTimes[t.label] ?? performance.now()));
                const tokens = typeof value?.tokens === 'number' ? value.tokens : (typeof value?.usage?.totalTokens === 'number' ? value.usage.totalTokens : undefined);
                return { ...v, imageUrl, text, durationMs, tokens };
              });
              const nextContent = t.label === "Image-GPT" ? text ?? m.content : m.content;
              return { ...m, variants: nextVariants, content: nextContent };
            }));
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : "An error occurred";
            setMessages((prev) => prev.map((m) => {
              if (m.id !== assistantId) return m;
              const nextVariants = (m.variants || []).map((v) => (v.label === t.label ? { ...v, text: message } : v));
              const nextContent = t.label === "Image-GPT" ? message : m.content;
              return { ...m, variants: nextVariants, content: nextContent };
            }));
          });
      });

      // Wait for all to finish before returning (allows button to re-enable)
      await Promise.allSettled(tasks.map((t) => t.promise));
      setShowLoadingSkeleton(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      setError(message);
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: message,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setLoading(false);
    }
  };

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const handleDrop: React.DragEventHandler<HTMLDivElement> = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setUploadedImage(dataUrl);
    } catch {
      // ignore
    }
  };

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  return (
    <div className="min-h-screen w-full bg-[var(--background)] text-[var(--foreground)] flex flex-col justify-center">
      <main className="flex flex-col items-center px-6 sm:px-8 py-16 gap-10">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Compare Image Models</h1>
        <div className="flex items-center gap-2 -mt-2">
          {[
            { key: "gemini", label: "Gemini" },
            { key: "imageGpt", label: "Image-GPT" },
            { key: "flux", label: "Flux-1" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedModels((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
              className={`${selectedModels[key as keyof typeof selectedModels] ? "bg-white text-black" : "bg-white/0 text-white/80 border border-white/15 hover:bg-white/5"} px-3 h-8 rounded-full text-sm transition-colors`}
            >
              {label}
            </button>
          ))}
        </div>

        {!hasRun ? (
          <>
            {/* Search/Input bar (landing) */}
            <div className={`w-full max-w-4xl ${transitioning ? "fade-out" : "fade-in"}`}>
              <div
                className={`relative rounded-2xl border ${isDragging ? 'border-white/30' : 'border-white/10'} bg-white/5 dark:bg-white/5 backdrop-blur p-3 sm:p-4`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex items-center gap-3">
                  <button aria-label="Add" className="shrink-0 h-10 w-10 rounded-full border border-white/15 text-white/80 hover:bg-white/10" onClick={(e) => { e.preventDefault(); fileInputRef.current?.click(); }}>+</button>
                  {uploadedImage ? (
                    <div className="relative h-10 w-10 rounded-md overflow-hidden border border-white/15">
                      <Image src={uploadedImage} alt="Selected" fill sizes="40px" unoptimized className="object-cover" />
                      <button
                        type="button"
                        aria-label="Remove image"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setUploadedImage(null); try { if (fileInputRef.current) fileInputRef.current.value = ""; } catch {} }}
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-black/70 text-white text-xs leading-none grid place-items-center border border-white/20"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const result = reader.result as string;
                        setUploadedImage(result);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.metaKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    placeholder="Start typing a prompt"
                    className="flex-1 bg-transparent outline-none text-base sm:text-lg placeholder-white/40"
                  />
                  <button aria-label="Run" className="shrink-0 h-10 px-4 rounded-full bg-white text-black hover:bg-white/90 flex items-center gap-2" onClick={() => handleSubmit()}>
                    <span>Run</span>
                    <span className="opacity-60 hidden sm:inline">⌘↩</span>
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          // Chat view
          <div className={`w-full max-w-4xl flex-1 flex flex-col ${transitioning ? "" : "fade-in"}`}>
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-6 pb-28">
              {messages.map((m, i) => (
                <div key={m.id}>
                  <div className="text-sm uppercase tracking-wider text-white/50 mb-2">
                    {m.role === "user" ? "User" : "Model response"}
                  </div>
                  <div className="p-2 whitespace-pre-wrap">
                    {m.role === "assistant" && m.content ? <p className="mb-4">{m.content}</p> : null}
                    {m.variants && m.variants.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {m.variants.map((v) => {
                          const isPending = !v.imageUrl && !v.text;
                          const hasImage = Boolean(v.imageUrl);
                          if (!isPending && !hasImage) return null; // hide fully if resolved without image
                          return (
                            <div key={v.label}>
                              <div className="text-xs uppercase tracking-wider text-white/50 mb-2">
                                {v.label}
                                {typeof v.durationMs === "number" && !isPending ? ` · ${(v.durationMs / 1000).toFixed(1)}s` : ""}
                                {typeof v.tokens === "number" && !isPending ? ` · ${v.tokens} token` : ""}
                              </div>
                              {isPending ? (
                                <div className="w-full flex justify-center">
                                  <div className="shimmer rounded-md border border-white/10 w-[256px] h-[256px]" />
                                </div>
                              ) : (
                                <div className="w-full flex justify-center">
                                  <ProgressiveImage
                                    src={v.imageUrl as string}
                                    alt={`${v.label} result`}
                                    onClick={() => setZoomUrl(v.imageUrl || null)}
                                    compareSrc={uploadedImage}
                                  >
                                    <div className="absolute bottom-2 left-2 pointer-events-auto">
                                      <button
                                        type="button"
                                        aria-label="Use this image"
                                        title="Use this image for edit"
                                        onClick={(e) => { e.stopPropagation(); if (v.imageUrl) setUploadedImage(v.imageUrl); }}
                                        className="h-8 w-8 rounded-full grid place-items-center border transition-colors bg-black/20 text-white/80 border-white/30 hover:bg-black/30"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                                        </svg>
                                      </button>
                                    </div>
                                    <div className="absolute bottom-2 right-2 pointer-events-auto">
                                      <a
                                        href={v.imageUrl as string}
                                        download
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => { e.stopPropagation(); }}
                                        className="h-8 w-8 rounded-full grid place-items-center border transition-colors bg-black/20 text-white/80 border-white/30 hover:bg-black/30"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/>
                                        </svg>
                                      </a>
                                    </div>
                                  </ProgressiveImage>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : m.imageUrl ? (
                      <ProgressiveImage
                        src={m.imageUrl}
                        alt="Generated"
                        onClick={() => setZoomUrl(m.imageUrl || null)}
                      >
                        <div className="absolute bottom-2 left-2 pointer-events-auto">
                          <button
                            type="button"
                            aria-label="Use this image"
                            title="Use this image for edit"
                            onClick={(e) => { e.stopPropagation(); if (m.imageUrl) setUploadedImage(m.imageUrl); }}
                            className="h-8 w-8 rounded-full grid place-items-center border transition-colors bg-black/20 text-white/80 border-white/30 hover:bg-black/30"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                            </svg>
                          </button>
                        </div>
                        <div className="absolute bottom-2 right-2 pointer-events-auto">
                          <a
                            href={m.imageUrl}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => { e.stopPropagation(); }}
                            className="h-8 w-8 rounded-full grid place-items-center border transition-colors bg-black/20 text-white/80 border-white/30 hover:bg-black/30"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/>
                            </svg>
                          </a>
                        </div>
                      </ProgressiveImage>
                    ) : (
                      m.content && m.role === "user" ? m.content : null
                    )}
                  </div>
                  {i < messages.length - 1 ? (
                    <div className="h-px bg-white/10 my-4" />
                  ) : null}
                </div>
              ))}
              {showLoadingSkeleton && loading ? (
                <div>
                  <div className="text-sm uppercase tracking-wider text-white/50 mb-2">Model responses</div>
                  <div className="p-2">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="spinner" />
                      <p className="text-white/70">Generating images…</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                      {selectedLabels.map((label) => (
                        <div key={label}>
                          <div className="text-xs uppercase tracking-wider text-white/50 mb-2">{label}</div>
                          <div className="w-full flex justify-center">
                            <div className="shimmer rounded-md border border-white/10 w-[256px] h-[256px]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              {error ? (
                <div>
                  <div className="text-sm uppercase tracking-wider text-white/50 mb-2">Model response</div>
                  <div className="p-2">
                    <p className="text-red-400">{error}</p>
                  </div>
                </div>
              ) : null}
              <div ref={chatEndRef} />
            </div>
            {zoomUrl ? (
              <div
                className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4"
                onClick={() => setZoomUrl(null)}
                aria-modal="true"
                role="dialog"
              >
                <button
                  aria-label="Close"
                  className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white"
                  onClick={() => setZoomUrl(null)}
                >
                  ×
                </button>
                <div className="relative w-[90vw] h-[85vh]">
                  <Image
                    src={zoomUrl}
                    alt="Zoomed image"
                    fill
                    sizes="90vw"
                    unoptimized
                    className="object-contain object-center rounded-lg shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            ) : null}

            {/* Chat bar moved to global composer below */}
          </div>
        )}
      </main>
      {/* Powered by Tigris footer (centered) */}
      <div className="w-full flex justify-center pb-4 mb-24">
        <a
          href="https://www.tigrisdata.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-1 text-white/70 hover:text-white"
        >
          <span className="text-sm">Powered by</span>
          <Image src="/tigris-logo.svg" alt="Tigris" width={96} height={24} />
        </a>
      </div>
      {/* Global chat composer fixed at bottom; visible during first transition and after */}
      <form onSubmit={handleSubmit} className={`fixed bottom-0 left-0 right-0 w-full transition-opacity duration-200 ${composerVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="mx-auto w-full max-w-3xl px-6 sm:px-8 pb-6">
          <div
            className={`rounded-2xl border ${isDragging ? 'border-white/30' : 'border-white/10'} bg-white/5 backdrop-blur p-3 sm:p-4 flex items-center gap-3`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <button aria-label="Add" type="button" className="shrink-0 h-10 w-10 rounded-full border border-white/15 text-white/80 hover:bg-white/10" onClick={() => fileInputRef.current?.click()}>+</button>
            {uploadedImage ? (
              <div className="relative h-10 w-10 rounded-md overflow-hidden border border-white/15">
                <Image src={uploadedImage} alt="Selected" fill sizes="40px" unoptimized className="object-cover" />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setUploadedImage(null); try { if (fileInputRef.current) fileInputRef.current.value = ""; } catch {} }}
                  className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-black/70 text-white text-xs leading-none grid place-items-center border border-white/20"
                >
                  ×
                </button>
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = reader.result as string;
                  setUploadedImage(result);
                };
                reader.readAsDataURL(file);
              }}
            />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Start typing a prompt"
              className="flex-1 bg-transparent outline-none text-base sm:text-lg placeholder-white/40"
            />
            <button type="submit" className="shrink-0 h-10 px-4 rounded-full bg-white text-black hover:bg-white/90 flex items-center gap-2" disabled={loading}>
              <span>{loading ? "Running" : "Run"}</span>
              {!loading && <span className="opacity-60 hidden sm:inline">⌘↩</span>}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// type CardProps = {
//   title: string;
//   description: string;
//   icon: string;
//   badge?: string;
// };

// function Card({ title, description, icon, badge }: CardProps) {
//   return (
//     <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
//       <div className="h-12 w-12 rounded-md bg-white/10 grid place-items-center">
//         <Image src={icon} alt="" width={24} height={24} />
//       </div>
//       <div className="flex-1 min-w-0">
//         <div className="flex items-center gap-2">
//           <h3 className="text-base font-medium truncate">{title}</h3>
//           {badge ? (
//             <span className="text-[10px] uppercase tracking-wider bg-white/10 border border-white/15 rounded px-1.5 py-0.5">{badge}</span>
//           ) : null}
//         </div>
//         <p className="text-sm text-white/70 mt-1">{description}</p>
//       </div>
//     </div>
//   );
// }
