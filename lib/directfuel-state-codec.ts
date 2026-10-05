const COMPRESSED_PREFIX = "directfuel:gzip:v1:";
export const D1_STATE_ROW_LIMIT_BYTES = 1_900_000;
const COMPRESSION_THRESHOLD_BYTES = 1_500_000;

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

function toBase64(value: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export async function encodeStoredState(serialized: string) {
  if (bytes(serialized) < COMPRESSION_THRESHOLD_BYTES) return serialized;
  const source = new Response(serialized).body;
  if (!source) throw new Error("Não foi possível preparar a compactação do estado.");
  const compressed = await new Response(source.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return COMPRESSED_PREFIX + toBase64(new Uint8Array(compressed));
}

export async function decodeStoredState<T = Record<string, unknown>>(stored: string): Promise<T> {
  if (!stored.startsWith(COMPRESSED_PREFIX)) return JSON.parse(stored) as T;
  const source = new Response(fromBase64(stored.slice(COMPRESSED_PREFIX.length))).body;
  if (!source) throw new Error("Não foi possível ler o estado compactado.");
  const serialized = await new Response(source.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(serialized) as T;
}

export function storedStateBytes(stored: string) {
  return bytes(stored);
}

