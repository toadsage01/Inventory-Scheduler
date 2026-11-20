#!/usr/bin/env node
/**
 * Break-glass password reset — for the day nobody can sign in anymore.
 *
 * Two ways to run it:
 *
 * 1. Direct (needs Node + the repo's dependencies on your machine):
 *      DATABASE_URL="postgres://.../db?sslmode=require" node scripts/reset-password.mjs you@company.com
 *    It asks for the new password, writes it straight to the database,
 *    and prints a confirmation. For Neon use the DIRECT (non-pooled)
 *    connection string for this one-off command.
 *
 * 2. SQL-only (no tooling at all — prints the statement instead of running it):
 *      node scripts/reset-password.mjs you@company.com --sql
 *    Paste the printed UPDATE into your database console (Neon → SQL Editor)
 *    and run it there.
 *
 * The hash format matches the app exactly (scrypt, 64-byte key, random 16-byte
 * hex salt), so the new password signs in like any other.
 *
 * Print nothing you wouldn't want leak: run this on your own machine, and
 * prefer the prompted password over a shell argument so it stays out of
 * your shell history.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.toLowerCase();
const sqlOnly = args.includes("--sql");
const passwordArg = args[args.indexOf("--password") + 1] ?? process.env.RESET_PASSWORD;

if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/reset-password.mjs <email> [--password <new-one>] [--sql]");
  process.exit(1);
}

let password = passwordArg;
if (!password && !sqlOnly) {
  const rl = readline.createInterface({ input, output });
  password = await rl.question("New password (min 8 characters): ");
  rl.close();
}
if (!password || password.length < 8) {
  console.error(sqlOnly ? "Note: pass the new password with --password so it lands in the SQL." : "Password must be at least 8 characters.");
  process.exit(1);
}

// Same scheme as src/lib/password.ts: "scrypt:<salt-hex>:<hash-hex>".
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const stored = `scrypt:${salt}:${hash}`;
const safeEmail = email.replace(/'/g, "''");
const sql =
  `UPDATE "User" SET "passwordHash" = '${stored}', "updatedAt" = now() ` +
  `WHERE "email" = '${safeEmail}';`;

if (sqlOnly) {
  console.log("-- Run this in your database console (Neon: Console → SQL Editor):");
  console.log(sql);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not set, so the statement was not run. Paste this into your database console instead:");
  console.log(sql);
  process.exit(0);
}

try {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const updated = await prisma.user.updateMany({
    where: { email },
    data: { passwordHash: stored },
  });
  await prisma.$disconnect();
  if (updated.count === 0) {
    console.error(`No account uses ${email} — nothing was changed. Check for a typo.`);
    process.exit(1);
  }
  console.log(`Done. ${email} can sign in with the new password now.`);
} catch (err) {
  console.log("Could not reach the database from here (missing prisma client or a bad connection string).");
  console.log("Run this SQL in your database console instead:");
  console.log(sql);
  console.log(`(reason: ${err instanceof Error ? err.message : String(err)})`);
}
