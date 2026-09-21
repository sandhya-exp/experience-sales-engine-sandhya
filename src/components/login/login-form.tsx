"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { login, type LoginFormState } from "@/app/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const initialState: LoginFormState = {};

const OAUTH_ERRORS: Record<string, string> = {
  google_not_configured: "Google sign-in isn't set up on this environment yet — use your email and password.",
  google_domain: "That Google account isn't part of the Experience.com team.",
  google_state: "The Google sign-in didn't complete — please try again.",
  google_failed: "Google sign-in failed — please try again or use your password.",
};

export function LoginForm({ oauthError }: { oauthError?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [show, setShow] = useState(false);
  const oauthMessage = oauthError ? OAUTH_ERRORS[oauthError] : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@experience.com" autoComplete="username" required className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            className="h-11 pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[13px] text-foreground">
          <Checkbox name="remember" defaultChecked />
          Remember me
        </label>
        <a href="mailto:it@experience.com?subject=Sales%20Engine%20password%20reset" className="text-[13px] font-medium text-primary hover:underline">
          Forgot password?
        </a>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {!state.error && oauthMessage && (
        <p className={oauthError === "google_not_configured" ? "rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground" : "text-sm text-destructive"}>
          {oauthMessage}
        </p>
      )}
      <Button type="submit" className="h-11 w-full text-[15px]" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"} <ArrowRight className="h-4 w-4" />
      </Button>
      <Button asChild type="button" variant="outline" className="h-11 w-full gap-3 text-[15px]">
        <a href="/api/auth/google">
          <GoogleMark /> Sign in with Google
        </a>
      </Button>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
