const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_RESUME_CHARS = 50000;

async function extractResumePdf(bytes) {
    const data = Buffer.from(bytes || []);
    if (data.length === 0) throw new Error('Choose a PDF file first.');
    if (data.length > MAX_PDF_BYTES) throw new Error('PDF must be 10 MB or smaller.');
    if (data.subarray(0, 5).toString() !== '%PDF-') throw new Error('The selected file is not a valid PDF.');

    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const result = await extractText(pdf, { mergePages: true });
    const text = String(result.text || '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_RESUME_CHARS);
    if (!text) throw new Error('No selectable text was found. Scanned/image-only PDFs need OCR before upload.');
    return text;
}

module.exports = { extractResumePdf };
