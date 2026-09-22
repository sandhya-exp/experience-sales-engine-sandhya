"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { login, type LoginFormState } from "@/app/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const initialState: LoginFormState = {};

/**
 * Email and password only. Sales Engine accounts are created by an
 * administrator — there is no self-service sign-up and no third-party sign-in,
 * so the only people who can get in are the ones already on the team.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [show, setShow] = useState(false);

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
      <Button type="submit" className="h-11 w-full text-[15px]" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"} <ArrowRight className="h-4 w-4" />
      </Button>
      <p className="pt-1 text-center text-[12.5px] text-muted-foreground">
        Sales Engine accounts are issued by your administrator. Need access? Ask your sales manager.
      </p>
    </form>
  );
}
