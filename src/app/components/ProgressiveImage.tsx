"use client";

import { useState, useRef } from "react";
import Image from "next/image";

export function ProgressiveImage({ src, alt, onClick, children, compareSrc, width = 256, height = 256 }: { src: string; alt: string; onClick?: () => void; children?: React.ReactNode; compareSrc?: string | null; width?: number | string; height?: number; }) {
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
  
    const widthValue = typeof width === 'number' ? `${width}px` : width;
    const heightValue = typeof height === 'number' ? `${height}px` : `${height}px`;
    const sizesStr = typeof width === 'number' ? `${width}px` : (typeof width === 'string' ? width : '256px');

    return (
      <div
        ref={containerRef}
        className="relative"
        style={{ width: widthValue, height: heightValue }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <div className={`absolute inset-0 shimmer rounded-md border border-white/10 transition-opacity duration-500 ${loaded ? "opacity-0" : "opacity-100"}`} />
  
        {showCompare && hoverX !== null ? (
          <>
            {/* Base/original image (full) */}
            <Image
              src={compareSrc as string}
              alt={`${alt} (original)`}
              fill
              sizes={sizesStr}
              unoptimized
              className={`absolute inset-0 object-cover rounded-md border border-white/10 ${loaded ? "opacity-100" : "opacity-0"}`}
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
              className={`absolute inset-0 object-cover rounded-md border border-white/10 cursor-zoom-in transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
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
            className={`absolute inset-0 object-cover rounded-md border border-white/10 cursor-zoom-in transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
            draggable={false}
          />
        )}
  
        {children ? <div className="absolute inset-0 pointer-events-none">{children}</div> : null}
      </div>
    );
  }