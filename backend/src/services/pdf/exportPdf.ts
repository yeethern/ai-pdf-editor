import { PDFDocument as PDFLibDocument } from 'pdf-lib';

interface PageImage {
  index: number;
  buffer: Buffer;
  width: number;
  height: number;
}

export async function exportPdf(pages: PageImage[]): Promise<Buffer> {
  const pdfDoc = await PDFLibDocument.create();
  pages.sort((a, b) => a.index - b.index);

  for (const page of pages) {
    const image = await pdfDoc.embedPng(page.buffer);
    const pdfPage = pdfDoc.addPage([page.width, page.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
  }

  return Buffer.from(await pdfDoc.save());
}
