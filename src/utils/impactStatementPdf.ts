// One-page annual "Food Waste Diversion Statement" PDF for a chosen reporting year.
// Lazy-loaded (jsPDF stays out of the main bundle), shares its header with the full report PDF.

import {
  type ImpactReport, type YearGroup, DEFAULT_COMPOSTING_FACTOR, DIVERSION_NOTE, SCOPE3_NOTE, SDG_TAGS, SDG_TITLE,
  compostDestinationLine, fmt1, fmtDate, fmtInt, isToDate, periodEnd, slugify,
} from '@/utils/impactReport';
import { GREEN, ascii, drawHeader } from '@/utils/pdfCommon';

export async function downloadStatementPdf(report: ImpactReport, year: YearGroup, pageUrl: string): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  let y = 0;

  const para = (t: string, size = 8, color = 60, gap = 1.2) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(color);
    for (const l of doc.splitTextToSize(ascii(t), W - 2 * M) as string[]) { doc.text(l, M, y); y += size * 0.42; }
    y += gap;
  };
  const heading = (t: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...GREEN);
    doc.text(t, M, y); y += 4.5;
  };
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const f = report.methodology.factors;
  const factor = f.compostingKgCo2ePerKg ?? DEFAULT_COMPOSTING_FACTOR;
  const s = report.settings;
  const toDate = isToDate(year);
  const hasBokashi = f.bokashiCompostingKgCo2ePerKg != null;
  const conservative = year.co2eVsLandfillKg;
  const measuredPct = year.litres > 0 ? (year.measuredLitres / year.litres) * 100 : 0;

  await drawHeader(doc, report.business, 'Annual statement from collection records');

  y = 41;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(40);
  doc.text('Food Waste Diversion Statement', M, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60);
  doc.text(`Reporting period: ${fmtDate(year.start)} to ${fmtDate(periodEnd(year))}${toDate ? ' (to date)' : ''}`, M, y);
  y += 7;

  heading('Summary');
  autoTable(doc, {
    theme: 'striped', startY: y, margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 1.4 }, headStyles: { fillColor: GREEN, fontSize: 8.5 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (d) => { if (d.section === 'head' && d.column.index === 1) d.cell.styles.halign = 'right'; },
    head: [['Measure', 'This period']],
    body: [
      ['Collections', fmtInt(year.pickups)],
      ['Wheelie bins', fmt1(year.bins)],
      ['Buckets', fmt1(year.buckets)],
      ['Volume', `${fmtInt(year.litres)} L`],
      ['Organic waste diverted from landfill', `${fmtInt(year.kg)} kg (${(year.kg / 1000).toFixed(2)} tonnes)`],
      [`Scope 3 emissions from this waste (Category 5, MfE composting factor ${factor})`, `${fmtInt(year.scope3Kg)} kg CO2e`],
      ['Emissions avoided vs landfill (MfE factors, conservative)', `${fmtInt(conservative)} kg CO2e`],
      ...(hasBokashi ? [['Emissions avoided incl. bokashi (Green Loop estimate, not an official factor)', `${fmtInt(year.co2eOurKg)} kg CO2e`]] : []),
    ],
  });
  y = lastY() + 3;
  para(DIVERSION_NOTE, 7.5, 90, 2.5);

  heading('Data quality');
  para(
    `${fmt1(measuredPct)}% of litres in this period come from measured collections; ${fmt1(100 - measuredPct)}% are estimated from the number of containers collected. ` +
    `Average fullness ${fmt1(s.avgFullnessPct)}%, from ${fmtInt(s.fullnessMeasuredContainers)} measured container${s.fullnessMeasuredContainers === 1 ? '' : 's'}` +
    `${s.fullnessSource === 'fleet' ? ' across all Green Loop customers (none measured for this business yet)' : ''}. ` +
    `Weight is estimated at ${fmt1(report.methodology.kgPerFullBin)} kg per full ${report.methodology.litresPerBin} L bin${s.kgPerFullBinIsDefault ? ' (the default estimate, not weighed)' : ''}.` +
    (report.methodology.invoicingStart && year.start < report.methodology.invoicingStart ? ` Collections before ${fmtDate(report.methodology.invoicingStart)} are estimated from farm bin records.` : ''),
    8, 60, 2.5,
  );

  heading('Treatment');
  para('Collected by electric van (charged from solar). Food waste is bokashi-fermented, then composted at Green Loop\'s site in Taranaki, New Plymouth.', 8, 60, 0.5);
  const dest = compostDestinationLine(report);
  if (dest) para(dest, 8, 60, 1);
  y += 1.5;

  heading('Method and sources');
  para(`Scope 3 (GHG Protocol Category 5, waste generated in operations) = kg diverted x ${factor} kg CO2e/kg, the official MfE composting factor; transport is counted as zero (electric van on solar). ${SCOPE3_NOTE}`, 7.5, 70);
  para(`Emissions avoided vs landfill = (landfill-with-gas-recovery factor ${f.foodWasteLandfillGasRecoveryKgCo2ePerKg} kg CO2e/kg [garden waste ${f.gardenWasteLandfillGasRecoveryKgCo2ePerKg}] + ${f.redBinLandfillKm} km trucking to Bonny Glen landfill at ${f.truckKgCo2ePerTonneKm} kg CO2e per tonne-km) - composting factor. ` +
    (hasBokashi ? `The bokashi figure counts only the nitrous oxide part of composting (${f.bokashiCompostingKgCo2ePerKg} kg CO2e/kg); it is Green Loop's own estimate, not yet confirmed by measurement.` : ''), 7.5, 70);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(0, 90, 160);
  for (const src of report.methodology.sources.filter((x) => !x.url.includes('food-scraps-bin'))) {
    const lines = doc.splitTextToSize(ascii(`${src.label}: ${src.url}`), W - 2 * M) as string[];
    doc.textWithLink(lines[0], M, y, { url: src.url }); y += 3.3;
    for (let i = 1; i < lines.length; i++) { doc.text(lines[i], M, y); y += 3.3; }
  }
  y += 2;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(60);
  const lbl = `${SDG_TITLE}: `;
  doc.text(lbl, M, y);
  const lw = doc.getTextWidth(lbl);
  doc.setFont('helvetica', 'normal');
  const sdg = doc.splitTextToSize(SDG_TAGS.join('  ·  '), W - 2 * M - lw) as string[];
  sdg.forEach((l, i) => doc.text(l, M + lw, y + i * 3.4));

  // Footer
  doc.setDrawColor(200); doc.line(M, H - 17, W - M, H - 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110);
  const foot = doc.splitTextToSize(`Issued by Green Loop · Sustainable Taranaki from collection records on ${fmtDate(new Date().toISOString().slice(0, 10))}. Live report: ${pageUrl}`, W - 2 * M) as string[];
  foot.forEach((l, i) => doc.text(l, M, H - 13 + i * 3.2));

  const slugPeriod = slugify(year.label) + (toDate ? '-to-date' : '');
  doc.save(`green-loop-diversion-statement-${slugify(report.business)}-${slugPeriod}.pdf`);
}
