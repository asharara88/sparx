"use client";
import { useEffect, useState } from "react";
import { HOME_NAME_KEY } from "./RememberHome";

/** On the sign-in screen: the name of the home this device last signed in to, when it knows one. */
export function WelcomeBack() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    try {
      setName(localStorage.getItem(HOME_NAME_KEY));
    } catch {
      setName(null);
    }
  }, []);
  if (!name) return null;
  return <p className="mt-1 font-semibold">Welcome back to {name}.</p>;
}
