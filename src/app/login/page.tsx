import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ExperienceLogo } from "@/components/brand/logo";
import { LoginForm } from "@/components/login/login-form";

/**
 * Internal sign-in for the sales / customer-success team. Two panels: the form,
 * and a quiet product panel that shows what the workspace is for (the pipeline
 * itself, not a mascot). Customers never land here — they use Talk to Sales (/inquire).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const oauthError = typeof sp.error === "string" ? sp.error : undefined;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card card-shadow lg:grid-cols-[1.05fr_1fr]">
        {/* Product panel */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-[#f6f8fd] p-10 lg:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, #d9e0ef 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="relative">
            <ExperienceLogo />
            <p className="section-label mt-10">Sales Engine</p>
            <h2 className="mt-2 text-[2rem] font-bold leading-tight tracking-tight text-foreground">
              From first inquiry to signed quote.
            </h2>
            <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
              One workspace for every opportunity: who asked, what they need, what happened last, and what to do next.
            </p>
          </div>

          <p className="relative text-xs text-muted-foreground">Better insights. Stronger relationships. Real growth.</p>
        </div>

        {/* Sign-in */}
        <div className="flex flex-col justify-center p-10 lg:p-12">
          <div className="lg:hidden">
            <ExperienceLogo className="mb-8" />
          </div>
          <h1 className="text-[1.75rem] font-bold tracking-tight text-foreground">Welcome back</h1>
          <p className="mb-7 mt-1 text-sm text-muted-foreground">Sign in to the Sales Engine with your Experience.com account.</p>
          <LoginForm oauthError={oauthError} />
          <p className="mt-6 text-xs text-muted-foreground">
            Demo account: <span className="font-medium text-foreground">sandhya@experience.com</span> /{" "}
            <span className="font-medium text-foreground">demo1234</span>
          </p>
          <div className="mt-8 border-t border-border pt-5 text-[13px] text-muted-foreground">
            Looking to talk to Experience.com about your business?{" "}
            <Link href="/inquire" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Talk to Sales <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
