import * as Sentry from "@sentry/node";

/**
 * Add a breadcrumb for tracking user flow through the app.
 * Useful for debugging what led up to an error.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>
) {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: "info",
  });
}
