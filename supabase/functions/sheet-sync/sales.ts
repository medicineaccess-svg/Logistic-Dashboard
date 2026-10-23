// "Monthy Sales Data" tab (Recordati sheet) -> monthly_sales rows.
// Values are copied as written. The only thing derived is the calendar month (sale_month):
//  - a month written with a year ("Nov-25", "Dec 2025", "Jan 2026") is used as is;
//  - a month written without a year ("April", "Mar") takes the year of the rows around it
//    (the tab runs in date order; the year moves on when the month wraps from Dec to Jan);
//  - labels that are not months ("Pending", "Biomarin") get no month and are shown as such.

export interface SaleRow {
  sheet_row: number;
  sales_person: string | null;
  month_label: string | null;
  sale_month: string | null;
  place: string | null;
  patient_name: string | null;
  hospital_doctor: string | null;
  product: string | null;
  quantity: number | null;
  price_per_pack_text: string | null;
  total_foreign: number | null;
  foreign_currency: 'EUR' | 'USD' | null;
  total_inr: number | null;
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const lc = (v: unknown) => clean(v).toLowerCase();

const MONTHS: [RegExp, number][] = [
  [/^jan/, 1], [/^feb/, 2], [/^mar/, 3], [/^apr/, 4], [/^may/, 5], [/^jun/, 6],
  [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^dec/, 12],
];

/** "Nov-25" -> {m:11,y:2025}; "April" -> {m:4,y:null}; "Pending" -> null */
export function parseMonthLabel(label: string): { m: number; y: number | null } | null {
  const t = lc(label);
  if (!t) return null;
  const hit = MONTHS.find(([re]) => re.test(t));
  if (!hit) return null;
  const ym = t.match(/(?:^|[^0-9])(\d{4}|\d{2})\s*$/);
  const y = ym ? (ym[1].length === 2 ? 2000 + Number(ym[1]) : Number(ym[1])) : null;
  return { m: hit[1], y };
}

export function num(v: unknown): number | null {
  const t = clean(v);
  if (!/\d/.test(t)) return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseSales(table: { row: number; values: unknown[] }[]): SaleRow[] {
  // header row = first row that has a "Patient Name" cell
  const hdrIdx = table.findIndex((r) => r.values.some((c) => lc(c) === 'patient name'));
  if (hdrIdx < 0) return [];
  const H = table[hdrIdx].values.map(lc);
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = H.findIndex((h) => h === n || h.startsWith(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const cMonth = col('month');
  const cSales = cMonth > 0 && !H[cMonth - 1] ? cMonth - 1 : -1; // salesperson column has no header
  const cPlace = col('place');
  const cPatient = col('patient name');
  const cHosp = col('hospital/dr name', 'hospital');
  const cProduct = col('product name');
  const cQty = col('product quantity', 'quantity');
  const cPrice = col('price per pack');
  const cEur = col('total price in euro');
  const cInr = col('total price in inr');
  const g = (v: unknown[], i: number) => (i >= 0 ? clean(v[i]) : '');

  // First explicit year in the tab (e.g. "May-25") seeds the year for earlier rows without one.
  let year: number | null = null;
  for (const r of table.slice(hdrIdx + 1)) {
    for (const i of [cSales, cMonth]) {
      const p = i >= 0 ? parseMonthLabel(g(r.values, i)) : null;
      if (p?.y) {
        year = p.y;
        break;
      }
    }
    if (year) break;
  }

  const out: SaleRow[] = [];
  let lastMonth: number | null = null;
  let sectionLabel = '';
  for (const r of table.slice(hdrIdx + 1)) {
    const v = r.values ?? [];
    const patient = g(v, cPatient);
    const product = g(v, cProduct);
    const monthCell = g(v, cMonth);
    const salesCell = g(v, cSales);
    const isTotal = [patient, product, g(v, cQty), g(v, cPrice)].some((x) => /^total$/i.test(x));

    if (!patient && !product) {
      // section header like "May-25", "Feb 2026", "March" in the first column (sets context only)
      if (salesCell && !monthCell && parseMonthLabel(salesCell)) {
        sectionLabel = salesCell;
        const p = parseMonthLabel(salesCell)!;
        if (p.y) year = p.y;
      }
      continue;
    }
    if (isTotal) continue;

    const label = monthCell || sectionLabel || '';
    const p = parseMonthLabel(label);
    let saleMonth: string | null = null;
    if (p) {
      if (p.y) year = p.y;
      else if (lastMonth !== null && year !== null && p.m <= lastMonth - 6) year += 1; // Dec -> Jan wrap
      if (year !== null) saleMonth = `${year}-${String(p.m).padStart(2, '0')}-01`;
      lastMonth = p.m;
    }
    const eurText = g(v, cEur);
    const priceText = g(v, cPrice);
    const cur: 'EUR' | 'USD' | null = /€/.test(eurText)
      ? 'EUR'
      : /\$|usd/i.test(eurText)
        ? 'USD'
        : num(eurText) !== null
          ? /\$|usd/i.test(priceText)
            ? 'USD'
            : 'EUR'
          : null;
    out.push({
      sheet_row: r.row,
      sales_person: salesCell || null,
      month_label: label || null,
      sale_month: saleMonth,
      place: g(v, cPlace) || null,
      patient_name: patient || null,
      hospital_doctor: g(v, cHosp) || null,
      product: product || null,
      quantity: num(g(v, cQty)),
      price_per_pack_text: priceText || null,
      total_foreign: num(eurText),
      foreign_currency: cur,
      total_inr: num(g(v, cInr)),
    });
  }
  return out;
}
