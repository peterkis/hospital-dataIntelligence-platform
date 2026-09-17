export const MAX_RAW_FILE_BYTES = 1024 * 1024;

export async function encodeWorkbenchFile(
  file: File,
  maxBytes = MAX_RAW_FILE_BYTES,
): Promise<string> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    file.size < 1 ||
    file.size > maxBytes
  )
    throw new Error("FILE_SIZE_OR_ENCODING");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > maxBytes)
    throw new Error("FILE_SIZE_OR_ENCODING");
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return btoa(text);
}
