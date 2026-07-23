import { PDFDocument } from 'pdf-lib';

/** Splits a PDF into single-page PDFs so each page can be sent to Bedrock Data Automation
 * as its own invocation. BDA's blueprint-based table extraction degrades sharply on long
 * documents (observed: 1-2 courses returned from a 20-page catalog vs. 16 fully-populated
 * courses from the same content split to a single page), so per-page invocation is the
 * reliable way to get complete extraction on large catalogs. */
export async function splitPdfIntoPages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const pages: Uint8Array[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const doc = await PDFDocument.create();
    const [copied] = await doc.copyPages(source, [index]);
    doc.addPage(copied);
    pages.push(await doc.save());
  }
  return pages;
}
