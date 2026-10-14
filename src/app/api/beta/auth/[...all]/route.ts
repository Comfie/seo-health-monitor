import { getBeta, notFound } from "@/lib/saas/server";

/** Better Auth endpoints, restricted to an explicit allowlist inside the auth wrapper. */
async function handle(request: Request) {
  const beta = await getBeta();
  if (beta.state === "disabled") return notFound();
  if (beta.state === "misconfigured") return Response.json({ error: "The beta is not available." }, { status: 503 });
  return beta.runtime.auth.handler(request);
}

export { handle as GET, handle as POST };
