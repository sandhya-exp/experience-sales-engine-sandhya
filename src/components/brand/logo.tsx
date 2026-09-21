"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// The official Experience.com logo lives at public/brand/exp.png
// (drop the brand-approved SVG or PNG there). If that file is ever missing or
// fails to load, we fall back to a plain text wordmark so the header never
// shows a broken image.
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
  // Only an actual load failure switches to the wordmark. An earlier version
  // also hid the image until its onLoad fired, which broke the moment the file
  // was in the browser cache: the image finished loading before React hydrated,
  // the handler never ran, and the logo stayed stuck on the text fallback —
  // invisibly correct on a cold cache, wrong on every reload after.
  const [failed, setFailed] = useState(false);
  const s = SIZE[size];

  if (failed) {
    return (
      <div className={cn("flex items-center gap-1.5 font-semibold tracking-tight", className)}>
        <span className={cn(s.text, dark ? "text-white" : "text-navy")}>experience</span>
        <span className={cn(s.text, dark ? "text-white/70" : "text-primary")}>.com</span>
      </div>
    );
  }

  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimization needed
    <img src={LOGO_SRC} alt="Experience.com" className={cn(s.img, "w-auto")} onError={() => setFailed(true)} />
  );

  // On the dark nav the logo sits in a white tile (like the contract module's
  // sidebar mark), so it renders correctly whether or not the PNG is transparent.
  return dark ? (
    <span className={cn("inline-flex items-center rounded-md bg-white px-2 py-[3px]", className)}>{img}</span>
  ) : (
    <span className={cn("inline-flex items-center", className)}>{img}</span>
  );
}
