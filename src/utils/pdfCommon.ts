// Helpers shared by the two impact PDFs (full report and annual statement).
import type { jsPDF } from 'jspdf';
import { loadLogoDataUrl } from '@/utils/impactReport';

export const GREEN: [number, number, number] = [45, 139, 78];

// jsPDF's built-in fonts only cover WinAnsi: strip macrons etc. so names like
// "Ngāmotu" don't render as garbage.
export const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Green header band (logo roundel on the left, business name, subtitle). Leaves the text colour white. */
export async function drawHeader(doc: jsPDF, business: string, subtitle: string): Promise<void> {
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 32, 'F');
  let tx = M;
  try {
    const logo = await loadLogoDataUrl();
    doc.addImage(logo, 'JPEG', M, 4, 24, 24);
    tx = M + 30;
  } catch { /* logo is decoration: carry on without it */ }
  doc.setTextColor(255); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Green Loop · Sustainable Taranaki', tx, 10);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(ascii(business), tx, 19);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(subtitle, tx, 25.5);
}
