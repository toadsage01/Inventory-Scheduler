import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

const SESSION_DAYS = Math.max(1, Math.min(90, Number(process.env.NEXTAUTH_SESSION_DAYS ?? 30) || 30));

// When the studio's Google OAuth client is configured, people can sign in
// with their company Google account and bookings mirror into their
// calendar. Without the env vars the app behaves exactly as before.
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_DAYS * 86400 },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toString().trim().toLowerCase();
        const password = credentials?.password?.toString() ?? "";
        if (!email || !password) return null;
        const user = await db.user.findUnique({
          where: { email },
          include: { team: true },
        });
        if (!user || !verifyPassword(password, user.passwordHash)) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID ?? "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
            // Offline access so the server can keep the calendar in sync
            // without the person being online in the app.
            authorization: {
              params: {
                scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
                access_type: "offline",
                prompt: "consent",
              },
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        // Google sign-in is a convenience for people the studio already
        // registered — it never creates accounts by itself.
        const email = user.email?.toLowerCase();
        if (!email) return false;
        const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
        return Boolean(existing);
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user?.id) {
        token.uid = user.id;
      }
      // First Google sign-in: match the account by email and keep the
      // calendar tokens so the server can mirror bookings later.
      if (account?.provider === "google" && user?.email) {
        const email = user.email.toLowerCase();
        const existing = await db.user.findUnique({ where: { email } });
        if (existing) {
          token.uid = existing.id;
          await db.user
            .update({
              where: { id: existing.id },
              data: {
                googleId: account.providerAccountId,
                googleAccessToken:
                  typeof account.access_token === "string" ? account.access_token : existing.googleAccessToken,
                googleRefreshToken:
                  typeof account.refresh_token === "string" ? account.refresh_token : existing.googleRefreshToken,
                googleTokenExpires:
                  typeof account.expires_at === "number"
                    ? new Date(account.expires_at * 1000)
                    : existing.googleTokenExpires,
              },
            })
            .catch(() => undefined);
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Fresh read on every request: role and permission changes land
      // immediately, and a deleted account is signed out on the spot.
      const uid = (token.uid as string) ?? session.user?.id ?? "";
      if (session.user) {
        session.user.id = uid;
        if (uid) {
          const user = await db.user.findUnique({
            where: { id: uid },
            include: { team: true },
          });
          if (user) {
            session.user.name = user.name;
            session.user.email = user.email;
            session.user.role = user.role;
            session.user.teamId = user.teamId;
            session.user.teamName = user.team?.name ?? null;
            session.user.pfp = user.pfp ?? null;
            session.user.canManageAssets = user.canManageAssets;
            session.user.canManageBookings = user.canManageBookings;
            session.user.canManagePeople = user.canManagePeople;
            session.user.canManageSettings = user.canManageSettings;
            session.user.googleConnected = Boolean(user.googleRefreshToken || user.googleAccessToken);
          }
        }
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET ?? "dev-only-insecure-secret",
};
