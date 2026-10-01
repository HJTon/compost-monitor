// Client-side PDF for the business impact report. jsPDF is loaded lazily
// (dynamic import) so it stays out of the main bundle.

import {
  type ImpactReport, MONTH_LONG, fmtDate, fmtInt, fmt1, fmtMass, fmtMonth, groupByYear, loadLogoDataUrl, ourCo2e, slugify,
} from '@/utils/impactReport';

// jsPDF's built-in fonts only cover WinAnsi: strip macrons etc. so names like
// "Ngāmotu" don't render as garbage.
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export async function downloadImpactPdf(report: ImpactReport, startMonth: number): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const GREEN: [number, number, number] = [45, 139, 78];
  let y = 0;

  const ensure = (need: number) => {
    if (y + need > H - 16) { doc.addPage(); y = 18; }
  };
  const heading = (t: string) => {
    ensure(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...GREEN);
    doc.text(t, M, y); y += 5;
    doc.setTextColor(40);
  };
  const para = (t: string, size = 8.5, indent = 0) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(60);
    const lines = doc.splitTextToSize(ascii(t), W - 2 * M - indent) as string[];
    for (const l of lines) { ensure(size * 0.5); doc.text(l, M + indent, y); y += size * 0.45; }
    y += 1.5;
  };
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Header band, with the logo in a white roundel on the left
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
  doc.text(ascii(report.business), tx, 19);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Food waste diverted from landfill', tx, 25.5);
  y = 40;
  doc.setTextColor(60); doc.setFontSize(9);
  const range = report.firstCollection && report.latestCollection
    ? `${fmtDate(report.firstCollection)} to ${fmtDate(report.latestCollection)}` : 'No collections yet';
  doc.text(`Data from ${range}. Generated ${fmtDate(new Date().toISOString().slice(0, 10))}.`, M, y);
  y += 8;

  // Stat tiles
  const t = report.totals;
  const mt0 = report.methodology;
  const hasBokashi = t.co2eVsLandfillBokashiKg != null;
  const ours = ourCo2e(t);
  const tiles: [string, string, string][] = [
    ['Food waste diverted', fmtMass(t.kg), t.kg >= 1000 ? `${fmtInt(t.kg)} kg` : ''],
    ['Volume', `${fmtInt(t.litres)} L`, `${fmtInt(t.pickups)} collections`],
    ['Emissions avoided (CO2e) vs the red bin', fmtMass(ours) + (hasBokashi ? '*' : ''), `${fmtMass(ours - t.co2eTransportKg)} landfill methane, ${fmtMass(t.co2eTransportKg)} trucking`],
  ];
  const tw = (W - 2 * M - 6) / 3;
  tiles.forEach(([label, value, sub], i) => {
    const x = M + i * (tw + 3);
    doc.setDrawColor(200, 220, 205); doc.setFillColor(240, 253, 244);
    doc.roundedRect(x, y, tw, 24, 2, 2, 'FD');
    doc.setTextColor(90); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(doc.splitTextToSize(label, tw - 4) as string[], x + 3, y + 5.5);
    doc.setTextColor(...GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(value, x + 3, y + 14);
    doc.setTextColor(100); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.text(doc.splitTextToSize(sub, tw - 6) as string[], x + 3, y + 19);
  });
  y += 30;
  if (hasBokashi) {
    para(`* Includes our four-week bokashi pre-fermentation, which leaves very little methane when the waste is composted (Green Loop's own estimate). Conservative figure using the standard Ministry for the Environment composting factor: ${fmtMass(t.co2eVsLandfillKg)} CO2e avoided. Use that figure if your reporting requires official factors.`, 7.5);
    y += 3;
  } else y += 2;

  // Header cells follow their column's alignment, so numbers sit under their headings.
  const rightAlignNumberHeads = (d: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => {
    if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right';
  };
  const head = [['Period', 'Pickups', 'Litres', 'Kg', `CO2e avoided (kg)${hasBokashi ? '*' : ''}`]];
  const tableStyle = {
    theme: 'striped' as const,
    headStyles: { fillColor: GREEN, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 1.6 },
    columnStyles: { 0: { cellWidth: 42 }, 1: { halign: 'right' as const }, 2: { halign: 'right' as const }, 3: { halign: 'right' as const }, 4: { halign: 'right' as const } },
    didParseCell: rightAlignNumberHeads,
    margin: { left: M, right: M },
  };

  // Yearly
  const yearLabel = startMonth === 1 ? 'calendar years' : `years starting ${MONTH_LONG[startMonth - 1]}`;
  heading(`By year (${yearLabel})`);
  autoTable(doc, {
    ...tableStyle, startY: y, head: [['Year', ...head[0].slice(1)]],
    body: groupByYear(report.months, startMonth).map((g) => [g.label, fmtInt(g.pickups), fmtInt(g.litres), fmtInt(g.kg), fmtInt(g.co2eOurKg)]),
  });
  y = lastY() + 8;

  // Monthly
  heading('By month');
  ensure(20);
  autoTable(doc, {
    ...tableStyle, startY: y, head: [['Month', ...head[0].slice(1)]],
    body: [...report.months].reverse().map((m) => [fmtMonth(m.month) + (mt0.invoicingStart && m.month < mt0.invoicingStart.slice(0, 7) ? ' ~' : ''), fmtInt(m.pickups), fmtInt(m.litres), fmtInt(m.kg), fmtInt(ourCo2e(m))]),
  });
  y = lastY() + 3;
  if (mt0.invoicingStart && report.months.some((m) => m.month < mt0.invoicingStart!.slice(0, 7))) para('~ Estimated from farm bin records.', 7.5);
  y += 4;

  // Piles
  heading('Compost piles your waste went into');
  if (report.piles.length) {
    ensure(20);
    autoTable(doc, {
      theme: 'striped', startY: y, margin: { left: M, right: M },
      head: [['Pile', 'Built (batching date)', 'Your containers']],
      headStyles: { fillColor: GREEN, fontSize: 8 }, styles: { fontSize: 8, cellPadding: 1.6 },
      columnStyles: { 2: { halign: 'right' } },
      didParseCell: (d) => { if (d.section === 'head' && d.column.index === 2) d.cell.styles.halign = 'right'; },
      body: report.piles.map((p) => [ascii(p.pile), p.batchingDate ? fmtDate(p.batchingDate) : 'Date not recorded', fmt1(p.containers)]),
    });
    y = lastY() + 3;
  }
  if (report.stillMaturing > 0) para(`${report.stillMaturing} container${report.stillMaturing === 1 ? '' : 's'} maturing or not yet recorded in a pile.`);
  y += 4;

  // Methodology
  const mt = report.methodology;
  const f = mt.factors;
  heading('How these numbers are worked out');
  const s = report.settings;
  para(`Weight: ${fmt1(mt.kgPerFullBin)} kg per full ${mt.litresPerBin} L bin${s.kgPerFullBinIsDefault ? ' (a standard estimate, not weighed)' : ''}.`);
  para(`Average fullness: ${fmt1(s.avgFullnessPct)}%, based on ${fmtInt(s.fullnessMeasuredContainers)} measured container${s.fullnessMeasuredContainers === 1 ? '' : 's'}${s.fullnessSource === 'fleet' ? ' across all Green Loop customers (none measured for this business yet)' : ''}.`);
  para(`${fmt1(t.measuredSharePct)}% of litres come from measured collections; the rest are estimated from the number of containers collected. Collections before ${fmtDate(mt.invoicingStart)} are estimated from farm bin records.`);
  para(`Emissions avoided compared with the red bin: what this waste would have emitted in landfill (with gas recovery, ${f.foodWasteLandfillGasRecoveryKgCo2ePerKg} kg CO2e/kg; garden waste ${f.gardenWasteLandfillGasRecoveryKgCo2ePerKg}) plus ${f.redBinLandfillKm} km of trucking to Bonny Glen landfill at ${f.truckKgCo2ePerTonneKm} kg CO2e per tonne-km (${f.redBinTransportKgCo2ePerKg} kg CO2e/kg), minus the emissions from our composting.`);
  para('Green Loop collects with an electric van charged from solar panels, so our transport emissions are counted as zero.');
  if (f.bokashiCompostingKgCo2ePerKg != null) para(`* Our composting and bokashi: our food waste ferments in bokashi for four weeks before it is composted, which leaves very little methane. So for our composting we count only the nitrous oxide part of the standard factor (${f.bokashiCompostingKgCo2ePerKg} kg CO2e/kg) and not its methane part (0.112 kg CO2e/kg). This is Green Loop's own estimate and hasn't yet been confirmed by measurement. Using the standard composting factor (${f.compostingKgCo2ePerKg} kg CO2e/kg) instead, the conservative figure is ${fmtMass(t.co2eVsLandfillKg)}.`);
  para('Landfill "with gas recovery" is used because Bonny Glen captures landfill gas; this is the conservative choice.');
  y += 1;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(60); ensure(6);
  doc.text('Sources', M, y); y += 4;
  for (const src of mt.sources.filter((x) => !x.url.includes('food-scraps-bin'))) {
    ensure(5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(0, 90, 160);
    const lines = doc.splitTextToSize(ascii(`${src.label}: ${src.url}`), W - 2 * M) as string[];
    doc.textWithLink(lines[0], M, y, { url: src.url });
    for (let i = 1; i < lines.length; i++) { y += 3.4; doc.text(lines[i], M, y); }
    y += 4;
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(130);
    doc.text('Green Loop · Sustainable Taranaki', M, H - 8);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }

  doc.save(`green-loop-impact-${slugify(report.business)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
