import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const handler = NextAuth(authOptions);

// Brute-force brake for the sign-in form. NextAuth's credentials callback is
// the one POST that carries an email and password, so it gets a strict
// per-IP budget; every other NextAuth POST (signout, csrf) passes through
// untouched. A shared office IP still gets 15 attempts per five minutes,
// which is plenty for real people and useless for guessing passwords.
// The wrapper must forward Next.js's route context (params.nextauth) —
// NextAuth's catch-all handler destructures it, and dropping it 500s.
const asRouteHandler = handler as unknown as (request: Request, context?: unknown) => Promise<Response>;

async function POST(request: Request, context?: unknown) {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/callback/credentials") || path.endsWith("/signin/credentials")) {
    const limiter = rateLimit(`login:${clientIp(request)}`, 15, 5 * 60_000);
    if (!limiter.ok) {
      return Response.json(
        {
          error: `Too many sign-in attempts. Try again in ${Math.max(1, Math.ceil(limiter.retryAfterSec / 60))} minute(s).`,
        },
        { status: 429 },
      );
    }
  }
  return asRouteHandler(request, context);
}

export { handler as GET, POST };
