"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "./api";

interface AuthGateProps {
  needsInit: boolean;
}

export function AuthGate({ needsInit }: AuthGateProps) {
  return (
    <main className="brand-glow flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="mb-8 text-center">
        <Image src="/praper-mark.png" alt="Praper" width={132} height={44} unoptimized className="mx-auto mb-4 h-9 w-auto opacity-90" priority />
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
          Every shoot. Every studio. <span className="brand-text">One calendar.</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Gear and studio rooms, booked by the crew, locked for the rest.
        </p>
      </div>

      <div className="w-full max-w-sm">
        {needsInit ? <BootstrapForm /> : <SignInForm />}
      </div>

      <p className="mt-8 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
        Sign in with the email your team lead registered. Sessions stay valid for a month on trusted devices.
      </p>
    </main>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);

  // The server exposes Google sign-in only when its OAuth client is set up.
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((res) => (res.ok ? res.json() : {}))
      .then((providers: Record<string, unknown>) => setGoogleReady(Boolean(providers && "google" in providers)))
      .catch(() => setGoogleReady(false));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (result?.error) {
      setError("That email and password combination did not match.");
    }
    // On success the session provider picks the new session up on its own.
  }

  return (
    <Card className="border-border/80 shadow-xl shadow-black/10">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back — the studio missed you.</CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signin-email">Email</Label>
            <Input
              id="signin-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signin-password">Password</Label>
            <Input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
        <CardFooter className="flex-col gap-2 pt-6">
          {googleReady ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full bg-white font-semibold text-[#37352f] hover:bg-secondary dark:bg-white dark:text-[#222222]"
                onClick={() => void signIn("google", { callbackUrl: "/" })}
              >
                <GoogleGlyph className="mr-2 h-4 w-4" />
                Sign in with company Google account
              </Button>
              <div className="flex w-full items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or with email</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          ) : null}
          <Button type="submit" className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Sign in
          </Button>
          <p className="text-xs text-muted-foreground">No account yet? Ask a team lead to add you.</p>
        </CardFooter>
      </form>
    </Card>
  );
}

function BootstrapForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/bootstrap", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      toast.success("Admin account created. Signing you in…");
      await signIn("credentials", { email, password, redirect: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
      setBusy(false);
    }
  }

  return (
    <Card className="border-border/80 shadow-xl shadow-black/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
          First run
        </CardTitle>
        <CardDescription>
          Create the admin account. It can then add people, teams, and gear.
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="boot-name">Your name</Label>
            <Input
              id="boot-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="boot-email">Email</Label>
            <Input
              id="boot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
            />
            <p className="text-xs text-muted-foreground">This becomes your permanent sign-in.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="boot-password">Password</Label>
            <Input
              id="boot-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Create admin account
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/** The official Google "G", drawn inline so no extra dependency is needed. */
function GoogleGlyph({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.98 11.98 0 0 0 12 0 11.99 11.99 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}
