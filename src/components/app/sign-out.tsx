import { connection } from "next/server";
import { authMode } from "@/lib/security/auth";
import { SignOutButton } from "./sign-out-button";

/** Resolved per request so a container configured at runtime shows the right control. */
export async function SignOutGate() {
  await connection();
  return authMode() === "password" ? <SignOutButton /> : null;
}
