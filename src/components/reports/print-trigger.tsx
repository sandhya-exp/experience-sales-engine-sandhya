"use client";

import { useEffect, useRef } from "react";

/**
 * Opens the print dialog once the report has rendered.
 *
 * The delay is not superstition: charts and web fonts settle a frame or two
 * after hydration, and printing before they do produces a page with the layout
 * half-applied. Guarded with a ref so React's development double-invoke doesn't
 * open two dialogs, and skipped entirely when the page is opened with
 * `?auto=0`, which is how you look at the report without printing it.
 */
export function PrintTrigger() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (new URLSearchParams(window.location.search).get("auto") === "0") return;
    fired.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);

  return null;
}
