"use client";
import type { FormEvent, ReactNode } from "react";
import { forgetThisPhone } from "@/lib/forget";

/** The sign-out form: clears what this phone kept for the signed-in member, then posts. */
export function SignOutForm({ children }: { children: ReactNode }) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await forgetThisPhone();
    form.submit();
  }
  return (
    <form action="/auth/signout" method="post" onSubmit={submit}>
      {children}
    </form>
  );
}
