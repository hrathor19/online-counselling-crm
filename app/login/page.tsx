'use client';

import { Suspense, useEffect, useState } from 'react';
import { getProviders, signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Asked of the server rather than assumed: the provider only exists when
  // GOOGLE_CLIENT_ID/SECRET are set, so an install without them shows the
  // password form alone instead of a button that goes nowhere.
  const [hasGoogle, setHasGoogle] = useState(false);

  useEffect(() => {
    getProviders()
      .then((p) => setHasGoogle(Boolean(p?.google)))
      .catch(() => setHasGoogle(false));
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });
      if (result?.error) {
        toast({
          variant: 'destructive',
          title: 'Login failed',
          description: result.error.startsWith('Too many failed attempts')
            ? result.error
            : 'Invalid email or password',
        });
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const callbackError = searchParams.get('error');

  /**
   * The `signIn` callback redirects here with a reason. Each one is a
   * different thing for the reader to do, so a single "Authentication
   * failed" would leave them guessing — and, worse, retrying.
   */
  const errorMessage = ({
    NoAccount: 'That Google account is not registered in this CRM. Ask your administrator to create your user first.',
    Deactivated: 'Your account has been deactivated. Contact your administrator.',
    GoogleUnverified: 'Google has not verified that email address, so it cannot be used to sign in.',
    OAuthAccountNotLinked: 'That email is already registered. Sign in with your password instead.',
  } as Record<string, string>)[callbackError ?? ''] ?? 'Authentication failed. Please try again.';

  return (
    <>
      {callbackError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm font-medium">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            className="h-10"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            className="h-10"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" className="mt-2 h-10 w-full text-sm font-semibold" disabled={isLoading || googleLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign In
        </Button>
      </form>

      {hasGoogle && (
        <>
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-10 w-full gap-2.5 text-sm font-semibold"
            disabled={isLoading || googleLoading}
            // No `await`: the call navigates away, so anything after it never
            // runs. The spinner is cleared by the page unloading.
            onClick={() => { setGoogleLoading(true); signIn('google', { callbackUrl: '/dashboard' }); }}
          >
            {googleLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <GoogleMark />}
            Continue with Google
          </Button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
            Use the Google account matching your CRM email. Signing in with Google does not
            create an account — your administrator does that.
          </p>
        </>
      )}
    </>
  );
}

/** Google's mark, inline so the button needs no network request to render. */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.0 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.0 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C37.1 40.2 44 35 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4
      bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100
      dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">

      {/* Decorative blobs — visible in both modes, gently drifting */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full
        bg-blue-400/20 blur-3xl dark:bg-blue-500/10 animate-float" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full
        bg-indigo-400/20 blur-3xl dark:bg-indigo-500/10 animate-float" style={{ animationDelay: '1.5s' }} />

      <div className="relative z-10 w-full max-w-sm animate-fade-in-up">

        {/* Brand mark */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30 transition-transform duration-300 ease-premium hover:scale-105 hover:rotate-3">
            <svg width="28" height="24" viewBox="0 0 30 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 0L7 13L18 26H24L13 13L24 0H18Z" fill="white" />
              <path d="M9 0L0 13L9 26H15L6 13L15 0H9Z" fill="white" opacity="0.6" />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">KollegeApply</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Counselling CRM · Lead Management</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/60 bg-card shadow-xl shadow-black/5
          dark:shadow-black/40 dark:border-border/40">
          <div className="px-6 pt-6 pb-2">
            <h2 className="text-lg font-semibold text-card-foreground">Sign in to your account</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Enter your credentials below to continue</p>
          </div>
          <div className="px-6 pb-6 pt-4">
            <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-muted" />}>
              <LoginFormInner />
            </Suspense>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}
