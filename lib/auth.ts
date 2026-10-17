import { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { Role } from '@prisma/client';
import { getLockoutRemaining, recordFailedLogin, clearFailedLogins } from './login-rate-limit';

// How often (seconds) a live JWT is re-checked against the DB, so that
// deactivating a user (or changing their role) takes effect mid-session
// instead of waiting out the full 24h token lifetime.
const TOKEN_REVALIDATE_SECONDS = 5 * 60;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    /**
     * Google sign-in.
     *
     * Registered only when the credentials are configured, so an install
     * without them simply shows the password form rather than a button that
     * errors. The login page asks the server which providers exist.
     *
     * This provider does NOT create accounts — see the `signIn` callback.
     * Authenticating with Google proves who someone is, not that they work
     * here; the CRM's own user list decides that.
     */
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          // `prompt: 'select_account'` so a shared machine does not silently
          // sign the next person in as whoever used it last.
          authorization: { params: { prompt: 'select_account' } },
        })]
      : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const lockoutSeconds = getLockoutRemaining(credentials.email);
        if (lockoutSeconds !== null) {
          throw new Error(
            `Too many failed attempts. Try again in ${Math.ceil(lockoutSeconds / 60)} minute(s).`
          );
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          select: { id: true, email: true, name: true, role: true, password: true, isActive: true, teamId: true },
        });

        if (!user || !user.isActive) {
          recordFailedLogin(credentials.email);
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          recordFailedLogin(credentials.email);
          return null;
        }

        clearFailedLogins(credentials.email);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          teamId: user.teamId ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Who is allowed through the Google door.
     *
     * Credentials sign-ins already passed `authorize`, so they are waved on.
     * A Google sign-in is accepted ONLY when the address already belongs to an
     * active user of this CRM: no self-service accounts, and a leaver loses
     * access the moment they are deactivated, exactly as with a password.
     *
     * Returning a string here sends the reader to /login with a reason, which
     * is friendlier than the generic "Authentication failed".
     */
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true;

      // Google tells us whether it actually verified the address. An
      // unverified one proves nothing about who controls the mailbox.
      const p = profile as { email?: string; email_verified?: boolean } | undefined;
      if (!p?.email || p.email_verified === false) {
        return '/login?error=GoogleUnverified';
      }

      const user = await prisma.user.findUnique({
        where: { email: p.email.toLowerCase() },
        select: { isActive: true },
      });
      if (!user) return '/login?error=NoAccount';
      if (!user.isActive) return '/login?error=Deactivated';
      return true;
    },

    async jwt({ token, user, account }) {
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (user) {
        /**
         * A Google `user` carries Google's own id, not ours, and no role —
         * so the CRM's record is looked up by email. Without this the token
         * would hold a Google subject id and every permission check would
         * fail to match a real user.
         */
        if (account?.provider === 'google') {
          const dbUser = await prisma.user.findUnique({
            where: { email: (user.email ?? '').toLowerCase() },
            select: { id: true, role: true, teamId: true, name: true },
          });
          // signIn already refused an unknown address; this is belt and braces.
          if (!dbUser) {
            token.invalidated = true;
            return token;
          }
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.teamId = dbUser.teamId ?? null;
          token.name = dbUser.name;
          token.lastValidated = nowSeconds;
          return token;
        }

        const u = user as { id: string; role: Role; teamId?: string };
        token.role = u.role;
        token.id = u.id;
        token.teamId = u.teamId ?? null;
        token.lastValidated = nowSeconds;
        return token;
      }

      // Periodically re-check the user against the DB so deactivation and
      // role changes propagate to live sessions within a few minutes.
      const lastValidated = (token.lastValidated as number | undefined) ?? 0;
      if (nowSeconds - lastValidated > TOKEN_REVALIDATE_SECONDS) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { isActive: true, role: true, teamId: true },
        });

        if (!dbUser || !dbUser.isActive) {
          token.invalidated = true;
        } else {
          token.role = dbUser.role;
          token.teamId = dbUser.teamId ?? null;
          token.lastValidated = nowSeconds;
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Deactivated mid-session — return no session so getServerSession()
      // yields null and every API route responds 401.
      if (token.invalidated) return null as unknown as Session;

      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.teamId = (token.teamId as string | null | undefined) ?? null;
      }
      return session;
    },
  },
};
