type TableName = "camera_runs" | "camera_samples";
type Method = "GET" | "POST" | "PATCH";

type DatabaseRequest = {
  method: Method;
  query?: Record<string, string>;
  body?: unknown;
  ignoreDuplicates?: boolean;
};

export class DatabaseError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); }
}

export function databaseFailure(error: unknown) {
  return Response.json({ error: error instanceof DatabaseError ? error.message : "The measurement service is unavailable. Try again." },
    { status: error instanceof DatabaseError ? error.status : 503 });
}

/** Server-only request helper for Supabase's Postgres REST API. */
export async function databaseRequest<T>(
  table: TableName,
  { method, query, body, ignoreDuplicates = false }: DatabaseRequest,
): Promise<T> {
  const projectUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!projectUrl || !secretKey) {
    throw new DatabaseError("Measurement storage is not configured. Set the server's Supabase URL and secret key.");
  }

  const url = new URL(`/rest/v1/${table}`, projectUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      apikey: secretKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { Prefer: `return=minimal${ignoreDuplicates ? ",resolution=ignore-duplicates" : ""}` }),
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
    // Inspect only a known error code; never forward arbitrary database messages.
    const error = await response.json().catch(() => null) as { code?: string } | null;
    const schemaMissing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code ?? "");
    throw new DatabaseError(schemaMissing
      ? "Measurement tables are out of date. Apply the Supabase migrations in the README."
      : "The database could not save or load measurements. Check the server configuration and connection.");
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
