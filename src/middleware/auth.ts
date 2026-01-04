import type { Context, Next } from "hono";
import { supabaseAdmin } from "../services/supabase.js";

type Variables = {
  userId: string;
  email: string;
};

export async function authMiddleware(
  c: Context<{ Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("userId", user.id);
  c.set("email", user.email ?? "");

  await next();
}

export function getUserId(c: Context<{ Variables: Variables }>): string {
  return c.get("userId");
}

export function getUserEmail(c: Context<{ Variables: Variables }>): string {
  return c.get("email");
}
