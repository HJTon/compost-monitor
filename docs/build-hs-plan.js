const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
} = require('docx');

// ---- palette (compost: warm green/brown) ----
const GREEN = '2D8B4E';
const DARK = '1F5C36';
const LIGHTGREEN = 'E5F2EA';
const GREY = 'F1F3F5';
const AMBER = 'B45309';

const CONTENT_WIDTH = 9360; // US Letter, 1" margins

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function h1(text) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] }); }
function h2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] }); }
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120, line: 276 }, children: [new TextRun({ text, ...opts })] });
}
function bullet(text, level = 0) {
  return new Paragraph({ numbering: { reference: 'bullets', level }, spacing: { after: 60, line: 264 }, children: [new TextRun(text)] });
}
function num(text) {
  return new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { after: 60, line: 264 }, children: [new TextRun(text)] });
}
function cell(content, { width, shade, bold, color, span, valign } = {}) {
  const runs = Array.isArray(content) ? content : [content];
  return new TableCell({
    borders: cellBorders, margins: cellMargins,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: span, verticalAlign: valign || VerticalAlign.TOP,
    shading: shade ? { fill: shade, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    children: runs.map(t => typeof t === 'string'
      ? new Paragraph({ spacing: { after: 0, line: 264 }, children: [new TextRun({ text: t, bold, color })] })
      : t),
  });
}
function headerRow(labels, widths, shade = GREEN) {
  return new TableRow({ tableHeader: true, children: labels.map((l, i) => cell(l, { width: widths[i], shade, bold: true, color: 'FFFFFF' })) });
}
function table(widths, rows) {
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, rows });
}
function spacer(after = 120) { return new Paragraph({ spacing: { after }, children: [new TextRun('')] }); }

// ---- risk register (composting operation) ----
const risks = [
  ['Bioaerosols & organic dust — Aspergillus fumigatus, thermophilic actinomycetes, endotoxins released when building, turning, screening or disturbing dry compost/mulch',
   'Site workers',
   'High',
   'P2/N95 respirator when turning, screening or handling dry/dusty material; keep material adequately moist to suppress dust; work upwind and avoid creating dust toward others; turn in calm conditions, not high wind; limit time in dusty tasks; workers with asthma, respiratory conditions or who are immunocompromised must not turn/disturb piles; wash hands & face afterwards.'],
  ['Thermal burns & scalding steam — active piles run hot (kill cycle 55 °C; cores monitored to ~93 °C / 200 °F); hot probes and steam release',
   'Site workers',
   'High',
   'Gloves when probing and handling hot material; insert/withdraw probes slowly and stand clear of steam; never reach hands into hot internal pockets; allow probes to cool before pocketing; keep face away from vents when opening a pile.'],
  ['Fire / spontaneous combustion — large or dry piles overheating (above ~70 °C) can self-ignite',
   'Site workers, property',
   'High',
   'Monitor temperatures daily (this app); keep moisture up; limit pile height/size per build spec; turn or aerate piles that overheat; keep a charged hose / water supply and extinguisher accessible; keep ignition sources and flammables away; know the fire emergency plan.'],
  ['Hazardous gases & oxygen deficiency — anaerobic pockets and enclosed maturation containers (closed bins, IBCs, in-ground vessels) can hold CO₂, ammonia, methane or hydrogen sulfide and be oxygen-deficient',
   'Site workers',
   'Medium',
   'Treat closed / in-ground / IBC containers as potential confined spaces — do not put your head or body inside; open and ventilate before working; never work alone on enclosed vessels; stop and withdraw if you smell ammonia/rotten-egg odour or feel dizzy; do not enter to retrieve dropped items.'],
  ['Biological pathogens & zoonoses — raw food waste, leachate and vermin/birds (e.g. leptospirosis, salmonella, gastro-intestinal illness)',
   'Site workers',
   'Medium',
   'Gloves whenever handling feedstock, compost or leachate; keep cuts covered; thorough hand-washing before eating/drinking/smoking and before leaving; no eating in the work area; keep tetanus immunisation current; pest/rodent control; avoid skin contact with leachate; clean & disinfect equipment.'],
  ['Manual handling — moving wheelie bins of mulch, building & turning piles by hand, lifting bags, containers, probes and equipment',
   'Site workers',
   'High',
   'Use mechanical aids (loader, trolley, barrow) where available; correct lifting technique — load close, bend knees, no twisting; team-lift heavy/awkward loads; split loads and don’t overfill; rotate tasks; report strain or discomfort early.'],
  ['Mobile plant & machinery — loader / tractor / compost turner / quad bike used to move material and turn piles',
   'Operators, bystanders',
   'High',
   'Only trained, authorised operators; pre-start machine checks; seatbelt and ROPS where fitted; keep guards in place; establish exclusion zones around operating plant; high-vis on site; reverse with care / use a spotter; no bystanders near turning or loading; isolate before clearing blockages.'],
  ['Slips, trips & falls — uneven ground, wet or greasy surfaces, leachate, hoses, and climbing on piles/windrows',
   'Site workers',
   'Medium',
   'Sturdy non-slip footwear; keep walkways and the working area tidy; manage leachate runoff and wet spots; route hoses clear of paths; avoid climbing on pile/windrow faces; take care on slopes and after rain.'],
  ['Sharps & contamination in incoming feedstock (glass, plastic, metal wrongly placed in food waste)',
   'Site workers',
   'Medium',
   'Gloves at all times; never hand-sort or reach blindly into feedstock; spread and inspect before incorporating; remove contaminants with tools; record contamination (Bin Tracker contamination feature) for follow-up with the source business; first aid + medical advice for any cut/puncture.'],
  ['Outdoor / environmental exposure — UV, heat, cold, rain and wind',
   'Site workers',
   'Low',
   'Sun protection (hat, sunscreen, sunglasses); hydration; weather-appropriate clothing and layers; reschedule dusty turning in high wind; manage heat-stress on hot days.'],
  ['Working alone on site — solo monitoring/turning, especially around machinery or enclosed containers',
   'Site workers',
   'Medium',
   'Phone carried & charged; check-in procedure with a contact; never do enclosed-container or machinery tasks alone; agreed escalation if a worker is unreachable.'],
  ['Water & electrical — irrigation/wash-down, pumps and leads used outdoors near water',
   'Site workers',
   'Low',
   'RCD-protected outlets; inspect leads before use and remove damaged ones; keep electrical gear and connections out of water; isolate before maintenance.'],
  ['Hand tools & probes — forks, screens, thermometers/probes',
   'Site workers',
   'Low',
   'Use the right tool for the task; keep tools maintained and stored safely; carry probes capped/pointed down; keep clear of others when using forks.'],
];

const ratingMatrix = [
  ['', 'Minor', 'Moderate', 'Major / Serious harm'],
  ['Likely', 'Medium', 'High', 'High'],
  ['Possible', 'Low', 'Medium', 'High'],
  ['Unlikely', 'Low', 'Low', 'Medium'],
];

const siteChecks = [
  'Water supply / hose & fire extinguisher accessible',
  'First-aid kit stocked & on site',
  'Respirators (P2/N95) available & in date',
  'Gloves, eye protection & footwear available',
  'Machinery pre-start check done (if plant in use)',
  'Walkways & work area clear of trip hazards',
  'Leachate / wet areas managed',
  'No piles showing fire-risk over-temperature',
  'Enclosed containers ventilated before any work',
  'Phone charged; lone-worker check-in agreed',
  'Pest/rodent control in order',
  'Weather suitable for planned tasks (wind for turning)',
];

const doc = new Document({
  creator: 'Green Loop / Compost Operations',
  title: 'Composting Operations Health & Safety Plan',
  description: 'Health and safety plan for the composting / pile-management side of the operation',
  styles: {
    default: { document: { run: { font: 'Arial', size: 21 } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal',
        run: { size: 52, bold: true, color: DARK, font: 'Arial' }, paragraph: { spacing: { after: 120 } } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, color: GREEN, font: 'Arial' },
        paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, color: DARK, font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 280 } } } },
      ]},
      { reference: 'numbers', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
      ]},
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT, spacing: { after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 2 } },
      children: [new TextRun({ text: 'Composting Operations — Health & Safety Plan', color: '888888', size: 16 })],
    })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      spacing: { before: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 2 } },
      tabStops: [{ type: 'right', position: CONTENT_WIDTH }],
      children: [
        new TextRun({ text: 'Uncontrolled when printed', color: '888888', size: 16 }),
        new TextRun({ text: '\tPage ', color: '888888', size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], color: '888888', size: 16 }),
        new TextRun({ text: ' of ', color: '888888', size: 16 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '888888', size: 16 }),
      ],
    })] }) },
    children: [
      // Title page
      new Paragraph({ spacing: { before: 1600 }, children: [] }),
      new Paragraph({ style: 'Title', children: [new TextRun('Health & Safety Plan')] }),
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: 'Composting Operations', size: 32, color: GREEN, bold: true })] }),
      new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: 'Green Loop — Taranaki', size: 24, color: '555555' })] }),
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({
        text: 'This plan covers the composting site — receiving and handling collected food scraps and mulch, building compost systems, daily temperature and condition monitoring, turning, maturation, sampling, and grow trials.',
        italics: true, color: '555555', size: 22 })] }),
      spacer(300),
      table([2600, 6760], [
        new TableRow({ children: [cell('Document', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('Composting Operations Health & Safety Plan', { width: 6760 })] }),
        new TableRow({ children: [cell('Version', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('1.0 (draft for review)', { width: 6760 })] }),
        new TableRow({ children: [cell('Issued', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('June 2026', { width: 6760 })] }),
        new TableRow({ children: [cell('Prepared by', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('___________________________', { width: 6760 })] }),
        new TableRow({ children: [cell('Approved by (PCBU)', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('___________________________', { width: 6760 })] }),
        new TableRow({ children: [cell('Site', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('___________________________', { width: 6760 })] }),
        new TableRow({ children: [cell('Next review', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('June 2027 (or after any notifiable event or significant change)', { width: 6760 })] }),
      ]),
      spacer(200),
      new Paragraph({ children: [new TextRun({ text: 'Note: This is a working template prepared to fit the composting operation. Site-specific details, names and contact numbers (marked “____”) must be completed, and the plan reviewed with workers, before it is relied upon.', size: 18, italics: true, color: AMBER })] }),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }),
      new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),

      new Paragraph({ children: [new PageBreak()] }),

      // 1 Purpose & scope
      h1('1. Purpose & Scope'),
      p('Green Loop (composting operations) is a Person Conducting a Business or Undertaking (PCBU) under the Health and Safety at Work Act 2015 (HSWA). This plan sets out how health and safety risks at the composting site are managed so that workers and others are not harmed.'),
      p('Scope — this plan applies to all activities on the composting / pile-management side of the operation:'),
      bullet('Receiving and handling collected food scraps and mulch (including contaminated loads).'),
      bullet('Building compost systems — Johnson-Su style piles, batch windrows, cylinders and carbon-cube builds.'),
      bullet('Daily monitoring — inserting probes to record temperatures, weather, moisture, odour and observations.'),
      bullet('Turning, screening and moving material (by hand and with mobile plant).'),
      bullet('Maturation in containers (open/closed bins, IBCs, in-ground vessels) and grow trials.'),
      bullet('Taking compost samples for laboratory readiness checks.'),
      bullet('Cleaning and maintaining tools, equipment, containers and the site.'),
      p('It applies to all workers (employees and contractors) and considers the safety of visitors and any members of the public who may be affected.'),

      // 2 Commitment
      h1('2. Health & Safety Commitment'),
      p('Green Loop is committed to providing a safe and healthy workplace and to meeting its duties under HSWA. So far as is reasonably practicable, it will:'),
      bullet('Provide and maintain a safe site, safe plant and equipment, and safe systems of work.'),
      bullet('Identify hazards and eliminate or minimise risks to health and safety.'),
      bullet('Provide the information, training, instruction and supervision workers need to work safely.'),
      bullet('Engage with workers on health and safety and enable their participation.'),
      bullet('Monitor worker health and site conditions to prevent harm — with particular attention to respiratory exposure.'),
      bullet('Record, report and investigate incidents and act to prevent recurrence.'),
      p('Workers must take reasonable care for their own and others’ safety, follow procedures and instructions, and report hazards and incidents.'),

      // 3 Legislation
      h1('3. Legislative Framework'),
      p('This plan is framed around:'),
      bullet('Health and Safety at Work Act 2015 (HSWA) — primary duties of PCBUs, officers and workers.'),
      bullet('Health and Safety at Work (General Risk and Workplace Management) Regulations 2016 — managing risks, first aid, emergency plans, facilities, remote/isolated work.'),
      bullet('Health and Safety at Work (Hazardous Substances) Regulations 2017 — for any cleaning/sanitising chemicals or fuels stored on site.'),
      bullet('Relevant WorkSafe New Zealand guidance, including guidance on bioaerosols/organic dust and on managing confined spaces.'),
      p('Where this plan and the law differ, the law prevails. WorkSafe is the regulator; certain serious events are notifiable (see Section 11).'),

      // 4 Roles
      h1('4. Roles & Responsibilities'),
      h2('PCBU (Green Loop)'),
      bullet('Holds the primary duty of care; ensures this plan is resourced, implemented and reviewed.'),
      bullet('Provides a safe site, safe plant, PPE (including respiratory protection), training and safe systems of work.'),
      h2('Officers (owners / directors)'),
      bullet('Exercise due diligence — understand the operation’s hazards (especially bioaerosols, fire and machinery), ensure resources and processes are in place, and verify they are used.'),
      h2('Site supervisor / Compost lead'),
      bullet('Day-to-day implementation: inductions, monitoring routines, machinery and pile management, incident response and record-keeping.'),
      bullet('Acts on hazard and incident reports and on over-temperature/fire-risk readings.'),
      h2('Workers (compost specialists / site staff)'),
      bullet('Take reasonable care for their own and others’ safety.'),
      bullet('Follow safe work procedures, wear the required PPE (including respirators for dusty tasks), and use plant and tools correctly.'),
      bullet('Report hazards, near-misses and incidents promptly.'),
      bullet('Stop and escalate any work they reasonably believe is unsafe.'),
      h2('Contractors & visitors'),
      bullet('Contractors follow this plan and their own safe practices; overlapping duties are coordinated.'),
      bullet('Visitors are inducted to site hazards, kept clear of plant and piles, and supervised.'),

      // 5 Engagement
      h1('5. Worker Engagement & Participation'),
      p('Engagement is kept practical for a small site team:'),
      bullet('Health and safety is a standing item in team catch-ups; workers can raise concerns at any time.'),
      bullet('Workers are consulted when hazards are identified, procedures change, or new plant/methods are introduced.'),
      bullet('Concerns and hazards observed during monitoring are recorded and reviewed by the site supervisor.'),
      bullet('Workers are told what action was taken on what they raised.'),

      // 6 Risk process
      h1('6. How We Manage Risk'),
      p('A simple, continuous process is used:'),
      num('Identify hazards — from the tasks above, worker reports, incidents and site checks.'),
      num('Assess the risk — likelihood and severity, using the guide in Appendix A.'),
      num('Control the risk — applying the hierarchy of controls below, preferring elimination.'),
      num('Review — check controls work and update after incidents or changes.'),
      h2('Hierarchy of controls'),
      bullet('Eliminate — e.g. avoid entering enclosed containers; reject unsafe/over-contaminated loads.'),
      bullet('Substitute / Isolate / Engineer — mechanical handling, moisture management to suppress dust and fire risk, guarding and exclusion zones around plant, ventilation of containers.'),
      bullet('Administrative — safe procedures, training, monitoring routines, lone-worker check-ins, limiting dusty-task exposure.'),
      bullet('PPE — P2/N95 respirator, gloves, eye protection, footwear, hi-vis — the last line of defence.'),

      // 7 Risk register
      h1('7. Composting Risk Register'),
      p('The table records the main hazards on the composting side, who is at risk, an initial risk rating, and the controls in place. It is reviewed regularly and after any incident.'),
      table([2700, 1250, 850, 4560], [
        headerRow(['Hazard', 'Who is at risk', 'Risk', 'Key controls'], [2700, 1250, 850, 4560]),
        ...risks.map(r => new TableRow({ children: [
          cell(r[0], { width: 2700 }),
          cell(r[1], { width: 1250 }),
          cell(r[2], { width: 850, shade: r[2] === 'High' ? 'F8D7DA' : r[2] === 'Medium' ? 'FFF3CD' : 'D4EDDA', bold: true }),
          cell(r[3], { width: 4560 }),
        ]})),
      ]),

      // 8 PPE
      h1('8. Personal Protective Equipment (PPE)'),
      p('Green Loop provides PPE; workers must wear it and keep it in good condition. Minimum PPE for composting work:'),
      bullet('Respiratory protection — a P2/N95 (or better) respirator when turning, screening or handling dry/dusty material, or whenever dust is visible. Fit matters; facial hair reduces seal.'),
      bullet('Gloves — whenever handling feedstock, compost, leachate, hot material or during cleaning.'),
      bullet('Eye protection — when there is dust, splashing or steam.'),
      bullet('Sturdy, closed, non-slip footwear (safety footwear recommended).'),
      bullet('High-visibility top/vest when mobile plant is operating on site.'),
      bullet('Sun protection (hat, sunscreen, sunglasses) for outdoor work.'),
      p('Damaged or worn PPE is reported and replaced. Respirators are stored clean and dry. Hand-washing is expected before eating, drinking, smoking or leaving the site.'),

      // 9 Safe work procedures
      h1('9. Safe Work Procedures'),
      h2('9.1 Receiving & handling feedstock'),
      bullet('Wear gloves; inspect loads as they are spread; never hand-sort or reach blindly into waste.'),
      bullet('Remove sharps/contaminants with tools and record contamination for follow-up.'),
      bullet('Manage leachate; keep the receiving area tidy.'),
      h2('9.2 Building & turning piles'),
      bullet('Use mechanical aids where available; lift correctly and team-lift heavy loads.'),
      bullet('Keep material adequately moist to suppress dust and fire risk; build to the agreed size/height.'),
      bullet('Wear a P2/N95 respirator when turning/screening; work upwind; avoid turning in high wind toward others or yourself.'),
      bullet('Workers with asthma/respiratory conditions or who are immunocompromised must not turn or disturb piles.'),
      h2('9.3 Temperature & condition monitoring'),
      bullet('Wear gloves; insert and withdraw probes slowly and stand clear of escaping steam.'),
      bullet('Do not reach hands into hot internal pockets; let probes cool before pocketing.'),
      bullet('Record readings in the app; flag any pile trending toward fire-risk temperatures (above ~70 °C) to the supervisor.'),
      h2('9.4 Working around mobile plant'),
      bullet('Only trained, authorised operators run the loader/tractor/turner/quad; complete pre-start checks; wear seatbelt where fitted.'),
      bullet('Keep guards in place; establish exclusion zones; no bystanders near operating plant.'),
      bullet('Make eye contact with operators; reverse with care or use a spotter; isolate before clearing blockages.'),
      h2('9.5 Enclosed maturation containers'),
      bullet('Treat closed bins, IBCs and in-ground vessels as potential confined spaces.'),
      bullet('Do not put your head or body inside; open and ventilate before working; never work alone on them.'),
      bullet('Withdraw immediately if you smell ammonia/rotten-egg gas or feel light-headed; do not enter to retrieve items.'),
      h2('9.6 Sampling'),
      bullet('Gloves on; take samples without disturbing more material than needed; avoid raising dust.'),
      bullet('Label and store samples cleanly; wash hands afterwards.'),
      h2('9.7 Hygiene, cleaning & spills'),
      bullet('Clean and disinfect tools, probes and containers on the agreed schedule and after fouling.'),
      bullet('Use any chemicals per the label/SDS; gloves and eye protection when decanting; never mix products.'),
      bullet('Clean up leachate/spills promptly; keep them out of drains/waterways.'),
      bullet('Keep cuts covered; wash hands thoroughly before eating, drinking, smoking or leaving.'),

      // 10 Emergency
      h1('10. Emergency Procedures'),
      h2('Immediate priorities'),
      num('Make the scene safe and protect yourself first.'),
      num('Render first aid; call 111 for any serious injury, fire or medical emergency.'),
      num('Notify the site supervisor as soon as it is safe to do so.'),
      h2('Fire / overheating pile'),
      bullet('For a small, contained over-temperature pile: turn/aerate and wet down; monitor closely.'),
      bullet('For any spreading or uncontrolled fire: evacuate to the assembly point and call 111 (Fire). Do not fight a fire that is unsafe to tackle.'),
      bullet('Keep the water supply/hose and extinguisher accessible at all times.'),
      h2('Burns / scalds (hot compost or steam)'),
      bullet('Cool the burn under cool running water for at least 20 minutes; do not apply creams; cover loosely.'),
      bullet('Seek medical advice for anything more than a minor surface burn.'),
      h2('Gas exposure / collapse near an enclosed container'),
      bullet('Do NOT enter to rescue — you may be overcome too. Move the person to fresh air only if you can do so safely; call 111.'),
      bullet('Ventilate; keep others clear; report the event.'),
      h2('Machinery incident'),
      bullet('Isolate/stop the machine; call 111 if anyone is injured; do not move a seriously injured person unless in danger; preserve the scene.'),
      h2('Biological exposure / cut / puncture'),
      bullet('Wash the wound, encourage bleeding, cover; seek medical advice promptly (mention compost/organic-waste exposure).'),
      h2('Emergency contacts'),
      table([3120, 6240], [
        new TableRow({ children: [cell('Emergency services', { width: 3120, shade: GREY, bold: true }), cell('111 (Fire / Ambulance / Police)', { width: 6240 })] }),
        new TableRow({ children: [cell('Site supervisor / compost lead', { width: 3120, shade: GREY, bold: true }), cell('Name: ______________  Phone: ______________', { width: 6240 })] }),
        new TableRow({ children: [cell('After-hours / officer', { width: 3120, shade: GREY, bold: true }), cell('Name: ______________  Phone: ______________', { width: 6240 })] }),
        new TableRow({ children: [cell('Site address (for 111)', { width: 3120, shade: GREY, bold: true }), cell('______________________________', { width: 6240 })] }),
        new TableRow({ children: [cell('Assembly point', { width: 3120, shade: GREY, bold: true }), cell('______________________________', { width: 6240 })] }),
        new TableRow({ children: [cell('WorkSafe (notifiable events)', { width: 3120, shade: GREY, bold: true }), cell('0800 030 040  —  worksafe.govt.nz', { width: 6240 })] }),
      ]),

      // 11 Incident reporting
      h1('11. Incident Reporting & Investigation'),
      p('All injuries, near-misses and significant hazards are reported to the site supervisor and recorded (Appendix C). Reports are reviewed so controls can be improved.'),
      h2('Notifiable events — WorkSafe'),
      p('Some events must be notified to WorkSafe as soon as possible (and the scene preserved). A notifiable event is a death, a notifiable injury or illness, or a notifiable incident arising from work. Examples relevant to this operation:'),
      bullet('An injury or illness requiring (or likely to require) hospital admission — e.g. a serious burn, a serious respiratory illness/infection, a crush or machinery injury, or a fracture.'),
      bullet('A serious infection attributable to the work (relevant to handling organic waste and bioaerosol exposure).'),
      bullet('A notifiable incident exposing a person to serious risk — e.g. an uncontrolled fire, an escape of gas, or a machinery near-miss with potential for serious harm.'),
      p('If unsure whether an event is notifiable, treat it as notifiable and call WorkSafe on 0800 030 040. Notifiable events are recorded and kept for at least 5 years.'),

      // 12 Training
      h1('12. Training, Induction & Competency'),
      bullet('Every worker completes a site health & safety induction covering this plan, the hazards, PPE (including respirator use/fit) and emergency procedures before working unsupervised.'),
      bullet('Mobile-plant operators are trained, competent and authorised for the machines they use.'),
      bullet('Workers are trained in safe manual handling, dust/bioaerosol controls, and enclosed-container precautions.'),
      bullet('Training and inductions are recorded (Appendix D). Refreshers follow incidents or changes.'),

      // 13 Health monitoring
      h1('13. Health Monitoring & Wellbeing'),
      bullet('Given bioaerosol exposure, workers are encouraged to report respiratory symptoms early; consider respiratory health checks for regular pile-turning staff.'),
      bullet('Tetanus immunisation is recommended for workers handling organic waste; cuts are kept covered.'),
      bullet('Manage heat stress, hydration and fatigue, especially on hot days and during heavy turning.'),
      bullet('Workers must not work impaired by drugs or alcohol, and never operate plant impaired.'),

      // 14 Plant & equipment
      h1('14. Plant, Equipment & Site Maintenance'),
      bullet('Mobile plant is maintained and serviced; pre-start checks completed; defective machines taken out of service.'),
      bullet('Guards, ROPS and seatbelts are kept functional; reversing aids working.'),
      bullet('Tools, probes, respirators and PPE are inspected, cleaned and replaced as needed.'),
      bullet('First-aid kit, fire extinguisher and water supply are kept available and in date.'),
      bullet('Site layout keeps walkways clear and separates people from operating plant.'),

      // 15 Contractors & visitors
      h1('15. Contractors & Visitors'),
      bullet('Contractors receive the relevant parts of this plan and must work safely; duties are coordinated where work overlaps.'),
      bullet('Visitors are inducted, kept clear of plant and piles, and accompanied/supervised on site.'),

      // 16 Review
      h1('16. Monitoring, Review & Improvement'),
      p('This plan is reviewed at least annually, and also:'),
      bullet('After any notifiable event or significant incident.'),
      bullet('When tasks, plant, methods, builds or the site change.'),
      bullet('When workers or WorkSafe identify a gap.'),
      p('Findings feed back into the risk register and procedures, closing the loop on continuous improvement.'),

      new Paragraph({ children: [new PageBreak()] }),

      // Appendix A
      h1('Appendix A — Risk Rating Guide'),
      p('Combine how likely harm is with how serious it could be to get a risk level. Use it to prioritise controls — High risks need action before the task proceeds.'),
      table([2340, 2340, 2340, 2340], [
        new TableRow({ children: ratingMatrix[0].map((c, i) => cell(c, { width: 2340, shade: i === 0 ? 'FFFFFF' : GREEN, bold: true, color: i === 0 ? '000000' : 'FFFFFF' })) }),
        ...ratingMatrix.slice(1).map(row => new TableRow({ children: row.map((c, i) => {
          if (i === 0) return cell(c, { width: 2340, shade: GREEN, bold: true, color: 'FFFFFF' });
          const shade = c === 'High' ? 'F8D7DA' : c === 'Medium' ? 'FFF3CD' : 'D4EDDA';
          return cell(c, { width: 2340, shade, bold: true });
        }) })),
      ]),
      spacer(80),
      bullet('High — stop and fix before continuing; strong controls and sign-off required.'),
      bullet('Medium — put controls in place and monitor; plan further improvement.'),
      bullet('Low — manage by routine procedures and good practice.'),

      // Appendix B
      h1('Appendix B — Daily Site Safety Check'),
      p('Complete at the start of each working day on site. Address any defect before starting affected tasks.'),
      table([6960, 2400], [
        headerRow(['Check', 'OK / Action'], [6960, 2400]),
        ...siteChecks.map(c => new TableRow({ children: [cell(c, { width: 6960 }), cell('', { width: 2400 })] })),
      ]),
      spacer(80),
      p('Checked by: ______________________   Date: ____________', { size: 20 }),

      // Appendix C
      h1('Appendix C — Incident / Hazard Report'),
      p('Use for injuries, near-misses and hazards.'),
      table([3120, 6240], [
        new TableRow({ children: [cell('Date & time', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Person(s) involved', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Location / system', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('What happened', { width: 3120, shade: GREY, bold: true }), cell([new Paragraph(''), new Paragraph(''), new Paragraph('')], { width: 6240 })] }),
        new TableRow({ children: [cell('Injury / harm', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Immediate action taken', { width: 3120, shade: GREY, bold: true }), cell([new Paragraph(''), new Paragraph('')], { width: 6240 })] }),
        new TableRow({ children: [cell('Notifiable to WorkSafe?', { width: 3120, shade: GREY, bold: true }), cell('Yes / No   (if yes, call 0800 030 040 & preserve the scene)', { width: 6240 })] }),
        new TableRow({ children: [cell('Reported to / by', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Follow-up / controls added', { width: 3120, shade: GREY, bold: true }), cell([new Paragraph(''), new Paragraph('')], { width: 6240 })] }),
      ]),

      // Appendix D
      h1('Appendix D — Worker Sign-Off'),
      p('I have read and understood this Health & Safety Plan, and I agree to follow the procedures and wear the required PPE.'),
      table([3120, 3120, 3120], [
        headerRow(['Name', 'Signature', 'Date'], [3120, 3120, 3120]),
        ...Array.from({ length: 6 }).map(() => new TableRow({ children: [cell('', { width: 3120 }), cell('', { width: 3120 }), cell('', { width: 3120 })] })),
      ]),
      spacer(160),
      new Paragraph({ children: [new TextRun({ text: 'End of plan.', italics: true, color: '888888' })] }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const out = '../Compost Operations Health and Safety Plan.docx';
  fs.writeFileSync(out, buffer);
  console.log('Wrote', out, buffer.length, 'bytes');
});
