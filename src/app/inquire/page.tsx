import { ShieldCheck, Clock, Users } from "lucide-react";
import { ExperienceLogo } from "@/components/brand/logo";
import type { Metadata } from "next";
import { TalkToSalesForm } from "@/components/inquire/talk-to-sales-form";

export const metadata: Metadata = {
  title: "Talk to Sales · Experience.com",
  description: "Tell us about your business and what you want to achieve — a specialist who knows your industry will reach out.",
};

/**
 * Talk to Sales — the public entry point. Deliberately simpler than the
 * internal workspace: one job — tell us what you need, we'll get in touch.
 * No sidebar, no pipeline language, nothing internal. (Route stays /inquire;
 * /talk-to-sales redirects here.)
 */
export default function TalkToSalesPage() {
  return (
    <div className="min-h-screen w-full bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <ExperienceLogo />
          <a href="https://experience.com" className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
            experience.com
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-16 pt-12">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="lg:pt-6">
            <p className="section-label">Talk to Sales</p>
            <h1 className="mt-2 text-[2.25rem] font-bold leading-[1.1] tracking-tight text-foreground">Tell us what you need — we&apos;ll set up a conversation</h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Share a few details about your organization and what you&apos;re trying to achieve. A member of our sales team who
              works with businesses like yours will review it, reach out, and you can pick a discovery-call time that suits you.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                { icon: Clock, title: "A reply within one business day", body: "Real people, not an auto-responder — and you can book a call right away." },
                { icon: Users, title: "Matched to a specialist", body: "Someone who knows your industry follows up." },
                { icon: ShieldCheck, title: "Your details stay with us", body: "Used only to prepare for our conversation." },
              ].map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                    <f.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{f.title}</p>
                    <p className="text-[13px] text-muted-foreground">{f.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-8 card-shadow sm:p-10">
            <TalkToSalesForm />
          </div>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Experience.com</span>
          <span>Better insights. Stronger relationships. Real growth.</span>
        </div>
      </footer>
    </div>
  );
}
