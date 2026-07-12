/* Client API JSON */
export async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* reponse vide */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const GET = (url) => api('GET', url);
export const POST = (url, body) => api('POST', url, body ?? {});
export const PUT = (url, body) => api('PUT', url, body ?? {});
export const DEL = (url) => api('DELETE', url);
