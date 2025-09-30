"use client";

import { useState, useRef } from "react";
import Image from "next/image";

type ProgressiveImageProps = {
  src: string;
  alt: string;
  onClick?: () => void;
  children?: React.ReactNode;
  compareSrc?: string | null;
  width?: number | string;
  height?: number | string;
  frame?: boolean;
};

export function ProgressiveImage({ src, alt, onClick, children, compareSrc, width = "100%", height = "100%", frame = true }: ProgressiveImageProps) {
    const [loaded, setLoaded] = useState(false);
    const [hoverX, setHoverX] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
  
    const handleMove = (e: React.MouseEvent) => {
      if (!compareSrc) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
      setHoverX(x / rect.width);
    };
  
    const handleLeave = () => {
      setHoverX(null);
    };
  
    const showCompare = Boolean(compareSrc);
    const clipPercent = hoverX !== null ? Math.round(hoverX * 100) : 50;
  
    const widthValue = typeof width === "number" ? `${width}px` : width;
    const heightValue = typeof height === "number" ? `${height}px` : height;
    const sizesStr = (() => {
      if (typeof width === "number") return `${width}px`;
      if (typeof width === "string") {
        const trimmed = width.trim();
        if (trimmed.endsWith("px") || trimmed.endsWith("vw") || trimmed.endsWith("vh")) {
          return trimmed;
        }
      }
      return "100vw";
    })();

    const frameClasses = frame ? "rounded-md border border-white/10" : "";
    const loaderClasses = frame ? "rounded-md" : "";

    return (
      <div
        ref={containerRef}
        className="relative h-full w-full"
        style={{ width: widthValue, height: heightValue }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <div className={`absolute inset-0 shimmer transition-opacity duration-500 ${loaderClasses} ${loaded ? "opacity-0" : "opacity-100"}`} />
  
        {showCompare && hoverX !== null ? (
          <>
            {/* Base/original image (full) */}
            <Image
              src={compareSrc as string}
              alt={`${alt} (original)`}
              fill
              sizes={sizesStr}
              unoptimized
              className={`absolute inset-0 object-cover ${frameClasses} ${loaded ? "opacity-100" : "opacity-0"}`}
              draggable={false}
              onClick={onClick}
            />
            {/* Generated image clipped to hover position */}
            <Image
              src={src}
              alt={alt}
              onLoad={() => setLoaded(true)}
              onClick={onClick}
              fill
              sizes={sizesStr}
              unoptimized
              style={{ clipPath: `inset(0 ${100 - clipPercent}% 0 0)` }}
              className={`absolute inset-0 object-cover ${frameClasses} cursor-zoom-in transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
              draggable={false}
            />
            {/* Divider line (visible on hover) */}
            <div
              className="absolute top-0 bottom-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              style={{ left: `${clipPercent}%` }}
            />
          </>
        ) : (
          <Image
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onClick={onClick}
            fill
            sizes={sizesStr}
            unoptimized
              className={`absolute inset-0 object-cover ${frameClasses} cursor-zoom-in transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
            draggable={false}
          />
        )}
  
        {children ? <div className="absolute inset-0 pointer-events-none">{children}</div> : null}
      </div>
    );
  }