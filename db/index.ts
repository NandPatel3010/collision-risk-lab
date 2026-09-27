type TableName = "camera_runs" | "camera_samples";
type Method = "GET" | "POST" | "PATCH";

type DatabaseRequest = {
  method: Method;
  query?: Record<string, string>;
  body?: unknown;
};

/** Server-only request helper for Supabase's Postgres REST API. */
export async function databaseRequest<T>(
  table: TableName,
  { method, query, body }: DatabaseRequest,
): Promise<T> {
  const projectUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!projectUrl || !secretKey) {
    throw new Error("Supabase is not configured for this deployment.");
  }

  const url = new URL(`/rest/v1/${table}`, projectUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      apikey: secretKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { Prefer: "return=minimal" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    // Never log request bodies or credentials; Supabase's error response can
    // contain submitted values, so report only safe request metadata.
    console.error("Supabase database request failed", {
      table,
      method,
      status: response.status,
    });
    throw new Error("The measurement database request failed.");
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
