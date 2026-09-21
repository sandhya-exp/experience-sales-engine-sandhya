"use server";

import { redirect } from "next/navigation";
import { verifyCredentials, createSession, destroySession } from "@/lib/auth";

export interface LoginFormState {
  error?: string;
}

export async function login(_prev: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const user = await verifyCredentials(email, password);
  if (!user) {
    return { error: "Invalid email or password." };
  }
  await createSession(user.id, formData.get("remember") === "on");
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
