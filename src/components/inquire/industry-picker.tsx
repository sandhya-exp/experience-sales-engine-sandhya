"use client";

import { useState } from "react";
import {
  Building2, Landmark, ShieldCheck, Wallet, HeartPulse, Stethoscope, Scale, UtensilsCrossed, BedDouble,
  ShoppingBag, Gem, Dumbbell, Scissors, GraduationCap, Car, Wrench, Briefcase, MoreHorizontal,
} from "lucide-react";
import { INDUSTRIES } from "@/lib/industries";
import { cn } from "@/lib/utils";

const ICONS: Record<(typeof INDUSTRIES)[number], React.ComponentType<{ className?: string }>> = {
  "Real Estate": Building2,
  Mortgage: Landmark,
  Insurance: ShieldCheck,
  "Financial Services": Wallet,
  Healthcare: HeartPulse,
  Dental: Stethoscope,
  Legal: Scale,
  Restaurants: UtensilsCrossed,
  "Hotels & Hospitality": BedDouble,
  "Retail & E-commerce": ShoppingBag,
  Jewellery: Gem,
  "Gyms & Fitness": Dumbbell,
  "Salons & Spas": Scissors,
  Education: GraduationCap,
  Automotive: Car,
  "Home Services": Wrench,
  "Professional Services": Briefcase,
  Other: MoreHorizontal,
};

/** Industry as a row of chips (one tap, no dropdown) — the value posts as `industry`. */
export function IndustryPicker({ name = "industry", defaultValue = "" }: { name?: string; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-1.5">
        {INDUSTRIES.map((opt) => {
          const Icon = ICONS[opt];
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              onClick={() => setValue(active ? "" : opt)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "border-navy bg-navy text-white"
                  : "border-border bg-card text-foreground hover:border-navy/40 hover:bg-muted"
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", active ? "text-white" : "text-muted-foreground")} />
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
