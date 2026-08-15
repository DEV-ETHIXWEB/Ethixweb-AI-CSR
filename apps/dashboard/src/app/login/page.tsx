import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

/**
 * LoginForm uses useSearchParams() (for the post-login `next` redirect
 * target) — Next.js requires that hook's nearest ancestor to be a
 * Suspense boundary so the page can still be statically generated at
 * build time rather than forcing this whole route to opt out of static
 * rendering.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
