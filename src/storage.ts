
import { put } from "@tigrisdata/storage";

export async function uploadFile(fileName: string, content: Buffer, contentType: string) {
    const imageResult = await put(`images/${fileName}`, content, {
        contentType,
        access: 'public',
        allowOverwrite: true,
    });
    return imageResult.data?.url;
  }