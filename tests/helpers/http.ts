import type { App } from '../../apps/api/src/app.ts';

export interface RequestOptions {
  cookieHeader?: string;
  headers?: Record<string, string>;
}

function mergeHeaders(opts: RequestOptions = {}, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra, ...opts.headers };
  if (opts.cookieHeader) headers.cookie = opts.cookieHeader;
  return headers;
}

export async function getJson(app: App, path: string, opts?: RequestOptions): Promise<Response> {
  return app.request(path, { method: 'GET', headers: mergeHeaders(opts) });
}

export async function postJson(
  app: App,
  path: string,
  body: unknown,
  opts?: RequestOptions,
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: mergeHeaders(opts, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

export async function putJson(
  app: App,
  path: string,
  body: unknown,
  opts?: RequestOptions,
): Promise<Response> {
  return app.request(path, {
    method: 'PUT',
    headers: mergeHeaders(opts, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

export async function deleteJson(
  app: App,
  path: string,
  body?: unknown,
  opts?: RequestOptions,
): Promise<Response> {
  return app.request(path, {
    method: 'DELETE',
    headers: mergeHeaders(opts, body === undefined ? {} : { 'content-type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Parses a JSON body, tolerating an empty body (some error responses have none). */
export async function jsonBody<T = unknown>(res: Response): Promise<T | undefined> {
  const text = await res.text();
  if (!text) return undefined;
  return JSON.parse(text) as T;
}
