export type UploadResult = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url?: string;
};

export function uploadFile(
  file: File,
  options: { targetTaskId?: string; purpose?: "TASK_DESCRIPTION"; onProgress?: (percent: number) => void }
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (options.targetTaskId) {
      form.append("targetType", "TASK");
      form.append("targetId", options.targetTaskId);
    }
    if (options.purpose) form.append("purpose", options.purpose);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/files/upload");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body?.error?.message ?? body?.message ?? `Upload ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Error de red al subir el archivo"));
    xhr.send(form);
  });
}
