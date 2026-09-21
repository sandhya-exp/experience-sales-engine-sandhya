"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// The official Experience.com logo lives at public/brand/exp.png
// (drop the brand-approved SVG or PNG there). Until that file is present,
// or if it fails to load, we fall back to a plain text wordmark so the
// header never shows a broken image.
const LOGO_SRC = "/brand/exp.png";

/**
 * Sizes follow the VOCE product, where the wordmark carries the top of the
 * sidebar rather than sitting in it apologetically: "lg" is the sidebar and the
 * sign-in screen, "sm" the compact header that replaces the sidebar on small
 * screens. The text fallback scales with it, so a missing PNG changes the mark
 * but never the layout.
 */
const SIZE = {
  sm: { img: "h-6", text: "text-lg" },
  lg: { img: "h-8", text: "text-2xl" },
} as const;

export function ExperienceLogo({
  className,
  dark,
  size = "lg",
}: {
  className?: string;
  dark?: boolean;
  size?: keyof typeof SIZE;
}) {
  const [failed, setFailed] = useState(false);
  // The image starts hidden and is revealed on load, so a missing or slow file
  // never flashes the browser's broken-image alt text before onError fires.
  const [loaded, setLoaded] = useState(false);
  const s = SIZE[size];

  if (!failed) {
    const img = (
      // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimization needed
      <img
        src={LOGO_SRC}
        alt="Experience.com"
        className={cn(s.img, "w-auto", loaded ? "block" : "hidden")}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
    if (!loaded) {
      return (
        <div className={cn("flex items-center gap-1.5 font-semibold tracking-tight", className)}>
          <span className={cn(s.text, dark ? "text-white" : "text-navy")}>experience</span>
          <span className={cn(s.text, dark ? "text-white/70" : "text-primary")}>.com</span>
          {img}
        </div>
      );
    }
    // On the dark nav the logo sits in a white tile (like the contract module's
    // sidebar mark), so it renders correctly whether or not the PNG is transparent.
    return dark ? (
      <span className={cn("inline-flex items-center rounded-md bg-white px-2 py-[3px]", className)}>{img}</span>
    ) : (
      <span className={cn("inline-flex items-center", className)}>{img}</span>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5 font-semibold tracking-tight", className)}>
      <span className={cn(s.text, dark ? "text-white" : "text-navy")}>experience</span>
      <span className={cn(s.text, dark ? "text-white/70" : "text-primary")}>.com</span>
    </div>
  );
}
