"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "cn";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InfoIcon } from "lucide-react";

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      });

      if (signInError) {
        setError(
          signInError.message || "Something went wrong. Please try again.",
        );
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={cn("flex w-full max-w-xs flex-col gap-6", className)}
      {...props}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tighter">
          Welcome back
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and password below.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive" role="alert">
              <InfoIcon />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2Icon className="animate-spin" />}
              {loading ? "Logging in..." : "Login"}
            </Button>
          </Field>
        </FieldGroup>
      </form>

      <FieldDescription className="text-center text-muted-foreground">
        Accounts are created by your admin.
        <br />
        Forgot your password? Contact your admin.
      </FieldDescription>
    </div>
  );
}
