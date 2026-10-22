// Google Sheet row -> shipment fields. Columns are located by HEADER NAME, never by position,
// so the team can insert/delete/reorder columns without breaking the sync.

export const STAGES = [
  'Inquiry',
  'Payment received',
  'Import permit',
  'CDEC form signed',
  'CDEC approved',
  'Order placed',
  'Shipped',
  'In customs',
  'Cleared',
  'Delivered',
  'POD received',
] as const;
export type Stage = (typeof STAGES)[number];
export type Department = 'NPP' | 'RARE_DISEASE';

export const stageIndex = (s: Stage) => STAGES.indexOf(s);

export const CT_HEADERS = ['CT Shipment ID', 'CT Stage (dashboard)', 'CT Last update'];

export interface SheetRecord {
  patient_name: string | null;
  hospital_name: string | null;
  doctor_name: string | null;
  medicine_name: string | null;
  strength: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  quantity_text: string | null;
  owner_name: string | null;
  region: string | null;
  manufacturer: string | null;
  cha_name: string | null;
  awb_number: string | null;
  payment_account: string | null;
  payment_received_date: string | null;
  /** the sheet explicitly says payment is NOT received (e.g. "Not Received", "Pending") */
  payment_not_received: boolean;
  /** exact text of the sheet's Payment status cell */
  sheet_payment_status: string | null;
  import_permit_date: string | null;
  order_placed_date: string | null;
  delivery_date: string | null;
  gst_pending: boolean;
  is_foc: boolean;
  stage: Stage;
  confident: boolean;
  status_text: string | null;
  review_note: string | null;
  last_dated: string | null;
  /** true when the stage came from an explicit column (payment/milestone columns), not free text */
  stage_from_text: boolean;
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export const norm = (v: unknown) => clean(v).toLowerCase();
export const key = (v: unknown) => norm(v).replace(/[^a-z0-9]/g, '');

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Parses 28/7/26, 8/24/2026, 02-Jul-2026, "Delivered (31/07/26)". Prefers day/month; never returns a future date. */
export function parseDate(text: unknown, today = new Date()): string | null {
  const t = clean(text);
  if (!t) return null;
  const todayIso = today.toISOString().slice(0, 10);
  let m = t.match(/(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})/);
  if (m) {
    const y = Number(m[3]) + (m[3].length === 2 ? 2000 : 0);
    const mo = MONTHS[m[2].toLowerCase()];
    const r = mo ? iso(y, mo, Number(m[1])) : null;
    return r && r <= todayIso ? r : null;
  }
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]) + (m[3].length === 2 ? 2000 : 0);
    for (const [d, mo] of [[a, b], [b, a]]) {
      const r = iso(y, mo, d);
      if (r && r <= todayIso) return r;
    }
  }
  return null;
}

/** Header dates like "16/10/27" (typo year) → that day/month in the current year. */
function headerDate(h: string, today = new Date()): string | null {
  const m = clean(h).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = today.getUTCFullYear();
  return iso(y, Number(m[2]), Number(m[1]));
}

function parseQty(v: unknown): { quantity: number | null; unit: string | null; text: string | null } {
  const t = clean(v);
  const m = t.match(/^(\d+(?:\.\d+)?)/);
  let unit: string | null = null;
  if (m && /pack/i.test(t)) unit = 'packs';
  else if (m && /bottl/i.test(t)) unit = 'bottles';
  else if (m && /vial/i.test(t)) unit = 'vials';
  return { quantity: m ? Number(m[1]) : null, unit, text: t || null };
}

function normOwner(v: unknown): string | null {
  let t = clean(v);
  if (!t) return null;
  t = t.replace(/\s+sir$/i, '').split('-')[0].trim();
  if (t.toUpperCase() === 'HO') return 'HO';
  if (/^ho /i.test(t)) return 'HO ' + t.slice(3).trim().toLowerCase();
  return t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** Free-text status → (stage, confident). Same rules as scripts/migrate_sheets.py. */
export function mapStatus(text: unknown, paymentReceived = false): [Stage | null, boolean] {
  let t = norm(text);
  if (!t) return [null, false];
  t = t.replace(/deliverd/g, 'delivered').replace(/delivefry/g, 'delivery').replace(/instransit/g, 'in transit').replace(/intransit/g, 'in transit');
  if (/will (be )?delivered|domestic delivery|out for delivery|\bofd\b/.test(t)) return ['Cleared', true];
  if (t.includes('delivered')) return ['Delivered', true];
  if (t.includes('custom')) return ['In customs', true];
  if (/stock (is currently )?(available )?(at|in) (our )?office|stock in office|in our office|stock with us|stock received|held at office/.test(t)) return ['Cleared', true];
  if (/in transit|shipped|dispatched|pickup done|picked up|awb shared|paper/.test(t)) return ['Shipped', true];
  if (/cdec (done|approved)|pick ?up|need to place the order/.test(t)) return ['CDEC approved', true];
  if (/order (has been )?placed|stock awaited|need to place order/.test(t)) return ['Order placed', true];
  if (/cdec (is )?(approval )?(is )?(currently )?(awaited|awaiting|awating|pending|shared)|waiting for cdec|cdec approval/.test(t)) return ['CDEC form signed', true];
  if (/apply (for )?cdec|il done|need to apply/.test(t)) return ['Import permit', true];
  if (/\bil\b|import licen|documents? (awaited|obtained)|required documents/.test(t)) return [paymentReceived ? 'Payment received' : 'Inquiry', true];
  if (t.includes('payment') && /await|pending/.test(t)) return ['Inquiry', true];
  return ['Inquiry', false];
}

export class Columns {
  private idx = new Map<string, number>();
  readonly dateCols: { col: number; date: string | null }[] = [];
  constructor(public headers: string[]) {
    headers.forEach((h, i) => {
      const n = norm(h);
      if (n && !this.idx.has(n)) this.idx.set(n, i);
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(clean(h))) this.dateCols.push({ col: i, date: headerDate(h) });
    });
  }
  find(...names: string[]): number {
    for (const n of names) {
      const i = this.idx.get(n);
      if (i !== undefined) return i;
    }
    for (const n of names) {
      for (const [h, i] of this.idx) if (h.startsWith(n)) return i;
    }
    return -1;
  }
  get(values: unknown[], ...names: string[]): string {
    const i = this.find(...names);
    return i < 0 ? '' : clean(values[i]);
  }
  ctIndexes(): number[] {
    return CT_HEADERS.map((h) => this.find(norm(h)));
  }
}

/** Cells that matter for the hash (everything except our own CT columns). */
export function rowSignature(cols: Columns, values: unknown[]): string {
  const ct = new Set(cols.ctIndexes().filter((i) => i >= 0));
  return cols.headers.map((_, i) => (ct.has(i) ? '' : clean(values[i]))).join('␟');
}

export function isBlank(cols: Columns, values: unknown[], dept: Department): boolean {
  const patient = cols.get(values, 'patient name');
  const med = cols.get(values, 'medicine name');
  if (dept === 'NPP') {
    const status = cols.get(values, 'overall status') || cols.get(values, 'delivery status') || cols.dateCols.some((d) => clean(values[d.col]));
    return !patient || (!med && !status);
  }
  return !patient && !med;
}

export function nppRecord(cols: Columns, v: unknown[]): SheetRecord {
  const g = (...n: string[]) => cols.get(v, ...n);
  const payDateText = g('payment received date');
  const payStatus = g('payment status');
  // "Not Received" contains the word "received" — check the negative first.
  const ps = norm(payStatus);
  const paymentNotReceived = /\bnot\b|pending|await|due|no\b/.test(ps);
  const paymentReceived = !paymentNotReceived && (/rec(ei|ie)ved|^yes|^paid|^done/.test(ps) || !!parseDate(payDateText) || /^(yes|rec(ei|ie)ved)/i.test(payDateText));
  const overall = g('overall status');
  const deliveryStatus = g('delivery status');
  const daily = cols.dateCols.map((d) => ({ date: d.date, text: clean(v[d.col]) })).filter((d) => d.text);
  const latest = daily[daily.length - 1];
  const notes: string[] = [];

  const [dStage, dConf] = latest ? mapStatus(latest.text, paymentReceived) : [null, false];
  const [oStage, oConf] = mapStatus(overall || deliveryStatus, paymentReceived);
  const [uStage] = deliveryStatus ? mapStatus(deliveryStatus) : [null];
  let stage: Stage | null;
  let confident: boolean;
  let statusText: string;
  if ([dStage, oStage, uStage].includes('Delivered')) {
    stage = 'Delivered';
    confident = true;
    statusText = dStage === 'Delivered' ? latest!.text : oStage === 'Delivered' ? overall : deliveryStatus;
  } else if (latest && dConf) {
    stage = dStage;
    confident = true;
    statusText = latest.text;
  } else {
    stage = oStage;
    confident = oConf;
    statusText = overall || deliveryStatus || latest?.text || '';
  }
  // A payment marked received moves an Inquiry forward to Payment received.
  if ((stage === null || stage === 'Inquiry') && paymentReceived) {
    stage = 'Payment received';
    confident = true;
  }
  if (!stage) {
    stage = 'Inquiry';
    confident = false;
  }
  if (!confident) notes.push(`Status text not recognised: '${statusText}'`);
  const exc = g('exceptions');
  if (exc) notes.push(`Exception: ${exc}`);
  const gst = /gst/i.test(overall + exc);
  const q = parseQty(g('qty', 'quantity'));
  const med = g('medicine name');
  const hospital = g('hospital');
  return {
    patient_name: g('patient name') || null,
    hospital_name: hospital && !/^n\/?a$/i.test(hospital) ? hospital : null,
    doctor_name: g('doctor name') || null,
    medicine_name: med || null,
    strength: g('strenght', 'strength') || null,
    quantity: q.quantity,
    quantity_unit: q.unit,
    quantity_text: q.text,
    owner_name: normOwner(g('concerned manager involved', 'owner')),
    region: null,
    manufacturer: null,
    cha_name: g('cha name') || null,
    awb_number: g('awb number', 'awb') || null,
    payment_account: g('payment received indian a/c/ hkg a/c', 'payment received indian') || null,
    payment_received_date: paymentReceived ? parseDate(payDateText) : null,
    payment_not_received: paymentNotReceived,
    sheet_payment_status: payStatus || null,
    import_permit_date: /^yes/i.test(g('import license')) ? null : parseDate(g('import license')),
    order_placed_date: null,
    delivery_date: stage === 'Delivered' ? parseDate(deliveryStatus) ?? parseDate(overall) : null,
    gst_pending: gst,
    is_foc: /foc/i.test(payDateText + med),
    stage,
    confident,
    status_text: statusText ? statusText.slice(0, 500) : null,
    review_note: notes.length ? notes.join('; ') : null,
    last_dated: latest?.date ?? null,
    stage_from_text: true,
  };
}

export function totRecord(cols: Columns, v: unknown[]): SheetRecord {
  const g = (...n: string[]) => cols.get(v, ...n);
  const l = (...n: string[]) => norm(g(...n));
  const pay = l('payment status');
  const ip = l('import permit');
  const cdec = l('cdec');
  const customs = l('customs clearance');
  const delivery = l('delivery status');
  const cands: Stage[] = [];
  if (['recieved', 'received', 'institutional order', 'rotaional order', 'rotational order'].includes(pay)) cands.push('Payment received');
  if (['recieved', 'received'].includes(ip)) cands.push('Import permit');
  if (['applied', 'in progress', 'pending'].includes(cdec)) cands.push('CDEC form signed');
  if (['received', 'recieved'].includes(cdec)) cands.push('CDEC approved');
  if (customs.startsWith('under process')) cands.push('In customs');
  if (customs === 'cleared') cands.push('Cleared');
  if (delivery === 'delivered') cands.push('Delivered');
  const stage = cands.length ? cands.reduce((a, b) => (stageIndex(b) > stageIndex(a) ? b : a)) : 'Inquiry';
  const bits = (
    [
      ['Payment', 'payment status'],
      ['Import permit', 'import permit'],
      ['CDEC', 'cdec'],
      ['Customs', 'customs clearance'],
      ['Delivery', 'delivery status'],
    ] as const
  )
    .map(([label, h]) => (g(h) ? `${label}: ${g(h)}` : ''))
    .filter(Boolean);
  const remarks = g('remarks');
  const q = parseQty(g('quantity'));
  const orderDate = parseDate(g('order date'));
  const notes: string[] = [];
  if (delivery === 'pending') notes.push("Delivery status 'Pending' in sheet");
  return {
    patient_name: g('patient name') || null,
    hospital_name: g('name of hospital', 'hospital') || null,
    doctor_name: null,
    medicine_name: g('medicine name') || null,
    strength: null,
    quantity: q.quantity,
    quantity_unit: q.unit,
    quantity_text: q.text,
    owner_name: normOwner(g('owner')),
    region: g('regions', 'region') || null,
    manufacturer: g('company') || null,
    cha_name: null,
    awb_number: g('awb number', 'awb') || null,
    payment_account: pay === 'institutional order' ? 'Institutional order' : null,
    payment_received_date: null, // the TOT sheet has no payment date column — don't invent one
    payment_not_received: ['pending', 'not received', 'awaited'].includes(pay),
    sheet_payment_status: g('payment status') || null,
    import_permit_date: null,
    order_placed_date: orderDate,
    delivery_date: stage === 'Delivered' ? parseDate(g('end date')) : null,
    gst_pending: false,
    is_foc: false,
    stage,
    confident: true,
    status_text: [bits.join('; '), remarks].filter(Boolean).join(' — ').slice(0, 500) || null,
    review_note: notes.length ? notes.join('; ') : null,
    last_dated: null, // TOT has no per-stage dates
    stage_from_text: false,
  };
}
