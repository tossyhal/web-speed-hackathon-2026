async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.ok) {
    return response;
  }
  throw new Error(`Request failed: ${response.status} ${response.statusText}`);
}

export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await request(url, { method: "GET" });
  return response.arrayBuffer();
}

export async function fetchJSON<T>(url: string): Promise<T> {
  const response = await request(url, { method: "GET" });
  return (await response.json()) as T;
}

export async function sendFile<T>(url: string, file: File): Promise<T> {
  const response = await request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: file,
  });
  return (await response.json()) as T;
}

export async function sendJSON<T>(url: string, data: object): Promise<T> {
  const response = await request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return (await response.json()) as T;
}
