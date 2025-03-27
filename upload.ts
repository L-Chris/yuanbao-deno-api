import * as path from "https://deno.land/std/path/mod.ts";
import mime from "mime";
import { dataUtil, uuid } from "./utils.ts";
import { generateHeaders } from "./api.ts";

export async function uploadFile(url: string, token: string) {
  let filename: string;
  let fileData: Uint8Array | ArrayBuffer;
  let mimeType: string | undefined;

  if (dataUtil.isBASE64Data(url)) {
    mimeType = dataUtil.extractBASE64DataFormat(url)!;
    const ext = mime.getExtension(mimeType!);
    filename = `${uuid()}.${ext}`;
    const base64Str = dataUtil.removeBASE64DataHeader(url);
    fileData = dataUtil.base64ToUint8Array(base64Str);
  } else {
    filename = path.basename(url);
    const res = await fetch(url);
    fileData = await res.arrayBuffer();
  }

  mimeType = mimeType || mime.getType(filename)!;
  const filetype = dataUtil.isImageMime(mimeType) ? "image" : "file";

  const uploadParamsRes = await fetch(
    "https://chat.qwen.ai/api/v1/files/getstsToken",
    {
      method: "POST",
      headers: {
        ...generateHeaders(token),
        "source": "web",
      },
      body: JSON.stringify({
        filename: filename,
        filesize: fileData.byteLength,
        filetype: filetype,
      }),
    },
  );
  const uploadParams: {
    access_key_id: string;
    access_key_secret: string;
    security_token: string;
    file_url: string;
    file_path: string;
    file_id: string;
    bucketname: string;
    region: string;
  } = await uploadParamsRes.json();

  console.log(uploadParams)
}
