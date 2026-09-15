export const MAX_STAFF_DOCUMENT_BYTES = 5 * 1024 * 1024;

export function validateStaffDocument(file) {
  if (!file || !/\.(pdf|jpe?g|png)$/i.test(file.name || "")) {
    throw new Error("Choose a PDF, JPG or PNG file.");
  }
  if (file.size > MAX_STAFF_DOCUMENT_BYTES) {
    throw new Error("Document must be 5 MB or smaller.");
  }
  return file;
}

export function documentFilename(file, recordId) {
  validateStaffDocument(file);
  const extension = file.name.split(".").pop().toLowerCase();
  return `${recordId}.${extension}`;
}

export function staffDocumentToDataUrl(file) {
  validateStaffDocument(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read document."));
    reader.readAsDataURL(file);
  });
}
