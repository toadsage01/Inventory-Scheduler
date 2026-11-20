// Next.js instrumentation hook: runs once when the server process boots.
// Long-running hosts (bare Node, Docker) get the reminder loop for free;
// serverless hosts can hit /api/notifications/run from external cron.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReminderWorker } = await import("@/lib/notify");
    startReminderWorker();
  }
}
