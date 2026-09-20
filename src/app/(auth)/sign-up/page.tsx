import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Регистрация" };
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await getSession()) redirect("/library");

  return <AuthForm mode="sign-up" />;
}
