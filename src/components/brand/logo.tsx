"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// The official Experience.com logo lives at public/brand/exp.png
// (drop the brand-approved SVG or PNG there). Until that file is present,
// or if it fails to load, we fall back to a plain text wordmark so the
// header never shows a broken image.
const LOGO_SRC = "/brand/exp.png";

export function ExperienceLogo({ className, dark }: { className?: string; dark?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (!failed) {
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimization needed
    const img = <img src={LOGO_SRC} alt="Experience.com" className="h-5 w-auto" onError={() => setFailed(true)} />;
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
      <span className={cn("text-lg", dark ? "text-white" : "text-navy")}>experience</span>
      <span className={cn("text-lg", dark ? "text-white/70" : "text-primary")}>.com</span>
    </div>
  );
}
