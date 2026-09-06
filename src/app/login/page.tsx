import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in — EduFix PK",
  description: "Sign in or create an EduFix PK account.",
};

export default function LoginPage() {
  return (
    <main className="auth-route">
      <AuthForm />
    </main>
  );
}