#!/usr/bin/env python3
"""
Legacy Google Sheets -> Logistics Control Tower migration.

Reads JSON exports of:
  * "NPP UPDATE" workbook  (tabs: NPM, Recordati)        -> raw/npp.json  (spreadsheets.get with grid data)
  * "Recordati All India Data" workbook (tab: TOT Sheet)  -> raw/tot.json  (values.get)

Writes:
  * out/import.json   compact rows for public.import_legacy_shipments(jsonb)
  * out/review.csv    every row with its mapped stage + why, for the AI person to check

Rules (see README "Migration"):
  * Current stage is taken from "Overall Status" (NPM) or the milestone columns (TOT),
    mapped by keyword to one of the 11 canonical stages.
  * Text that cannot be mapped confidently -> stage Inquiry + needs_review.
  * Contradictions (e.g. Overall Status says Delivered, latest daily column says otherwise)
    -> keep Overall Status, set needs_review with a note.
  * Daily update columns become history rows, so nothing is lost.
  * Patient phone numbers / Aadhaar columns are NOT imported.
"""
import csv
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

STAGES = [
    "Inquiry", "Payment received", "Import permit", "CDEC form signed", "CDEC approved",
    "Order placed", "Shipped", "In customs", "Cleared", "Delivered", "POD received",
]
IMPORT_DAY = date(2026, 10, 21)


def clean(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def parse_date(text, prefer_dmy=True):
    """Return ISO date or None. Handles 28/7/26, 8/24/2026, 02-Jul-2026, (31/07/26)."""
    t = clean(text)
    if not t:
        return None
    m = re.search(r"(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})", t)
    if m:
        d, mon, y = m.groups()
        y = int(y) + (2000 if len(y) == 2 else 0)
        try:
            return datetime.strptime(f"{d} {mon[:3].title()} {y}", "%d %b %Y").date().isoformat()
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", t)
    if m:
        a, b, y = (int(x) for x in m.groups())
        y = y + 2000 if y < 100 else y
        candidates = [(a, b), (b, a)] if prefer_dmy else [(b, a), (a, b)]
        for d, mo in candidates:
            try:
                dt = date(y, mo, d)
            except ValueError:
                continue
            if dt <= IMPORT_DAY:
                return dt.isoformat()
    return None


def norm_owner(v):
    v = clean(v)
    if not v:
        return None
    v = re.sub(r"\s+sir$", "", v, flags=re.I)
    v = v.split("-")[0].strip()
    if v.upper() == "HO":
        return "HO"
    if v.lower().startswith("ho "):
        return "HO " + v[3:].strip().lower()
    return v.title()


def parse_qty(v):
    t = clean(v)
    m = re.match(r"^(\d+(?:\.\d+)?)", t)
    unit = None
    if m and re.search(r"pack", t, re.I):
        unit = "packs"
    elif m and re.search(r"bottl", t, re.I):
        unit = "bottles"
    elif m and re.search(r"vial", t, re.I):
        unit = "vials"
    return (float(m.group(1)) if m else None), unit, (t or None)


def map_status(text, payment_received=False):
    """Map free-text status to (stage, confident: bool)."""
    t = clean(text).lower()
    if not t:
        return None, False
    t = t.replace("deliverd", "delivered").replace("delivefry", "delivery").replace("instransit", "in transit").replace("intransit", "in transit")
    if re.search(r"will (be )?delivered|domestic delivery|out for delivery|\bofd\b", t):
        return "Cleared", True
    if "delivered" in t:
        return "Delivered", True
    if "custom" in t:
        return "In customs", True
    if re.search(r"stock (is currently )?(available )?(at|in) (our )?office|stock in office|in our office|stock with us|stock received|held at office", t):
        return "Cleared", True
    if re.search(r"in transit|shipped|dispatched|pickup done|picked up|awb shared|paper", t):
        return "Shipped", True
    if re.search(r"cdec (done|approved)|pick ?up|need to place the order", t):
        return "CDEC approved", True
    if re.search(r"order (has been )?placed|stock awaited|need to place order", t):
        return "Order placed", True
    if re.search(r"cdec (is )?(approval )?(is )?(currently )?(awaited|awaiting|awating|pending|shared)|waiting for cdec|cdec approval", t):
        return "CDEC form signed", True
    if re.search(r"apply (for )?cdec|il done|need to apply", t):
        return "Import permit", True
    if re.search(r"\bil\b|import licen|documents? (awaited|obtained)|required documents", t):
        return ("Payment received" if payment_received else "Inquiry"), True
    if "payment" in t and re.search(r"await|pending", t):
        return "Inquiry", True
    return "Inquiry", False


def stage_max(*stages):
    idx = [STAGES.index(s) for s in stages if s]
    return STAGES[max(idx)] if idx else None


rows_out, review = [], []


def emit(rec, why):
    rows_out.append(rec)
    review.append({
        "code": rec["code"], "dept": rec["department"], "source": rec["source_ref"],
        "patient": rec.get("patient_name") or "", "medicine": rec["medicine_name"],
        "stage": rec["current_stage"], "status_text": rec.get("status_text") or "",
        "needs_review": rec["needs_review"], "note": rec.get("review_note") or "", "why": why,
        "archived": bool(rec.get("archive_reason")),
    })


# ---------------------------------------------------------------- NPP UPDATE / NPM
npp = json.load(open(ROOT / "raw" / "npp.json"))
tabs = {s["properties"]["title"]: [[clean(c.get("formattedValue")) for c in r.get("values", [])]
                                   for r in s["data"][0].get("rowData", [])] for s in npp["sheets"]}

npm = tabs["NPM"]
header = npm[0]
DATE_COLS = list(range(23, 29))
DATE_COL_DATES = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]
seen = set()
n = 0
for i, r in enumerate(npm[1:], start=2):
    r = r + [""] * (29 - len(r))
    patient, med = r[1], r[5]
    overall = r[22]
    daily = [(DATE_COL_DATES[k], r[c]) for k, c in enumerate(DATE_COLS) if r[c]]
    if not med and not overall and not daily and not r[20]:
        continue  # empty / name-only row
    key = (patient.lower(), med.lower(), r[6].lower(), overall.lower(), tuple(d[1].lower() for d in daily))
    if key in seen:
        continue  # exact duplicate row
    seen.add(key)

    pay_text = (r[3] + " " + r[13]).lower()
    payment_received = "received" in r[13].lower() or bool(parse_date(r[3])) or r[3].lower().startswith("yes")
    is_foc = "foc" in (r[3] + r[5]).lower()
    # The dated columns (14-19 Oct) are the most recent entries; Overall Status is sometimes stale.
    notes = []
    d_stage, d_conf = map_status(daily[-1][1], payment_received) if daily else (None, False)
    o_stage, o_conf = map_status(overall or r[20], payment_received)
    u_stage = map_status(r[20])[0] if r[20] else None
    if "Delivered" in (d_stage, o_stage, u_stage):
        # Delivered is final: any column saying delivered wins over older in-progress notes.
        status_text = next(t for t, st in ((daily[-1][1] if daily else "", d_stage), (overall, o_stage), (r[20], u_stage)) if st == "Delivered")
        stage, confident = "Delivered", True
        others = {x for x in (d_stage, o_stage) if x and x != "Delivered"}
        if others:
            notes.append(f"Marked Delivered (from '{status_text}') but other columns say: " + "; ".join(sorted({t for t, st in ((daily[-1][1] if daily else '', d_stage), (overall, o_stage)) if st and st != 'Delivered'})))
    elif daily and d_conf:
        status_text, stage, confident = daily[-1][1], d_stage, True
        if overall and o_stage and o_stage != d_stage:
            notes.append(f"Latest dated column ({daily[-1][0]}) says '{daily[-1][1]}' but Overall Status says '{overall}'")
    else:
        status_text = overall or r[20] or (daily[-1][1] if daily else "")
        stage, confident = o_stage, o_conf
        if daily and not d_conf and daily[-1][1] != status_text:
            notes.append(f"Latest dated column says '{daily[-1][1]}' (not recognised); used Overall Status")
    if stage is None:
        stage, confident = "Inquiry", False
    if not confident:
        notes.append(f"Status text not recognised: '{status_text}'")
    if not med:
        notes.append("Medicine name missing in sheet")
    if r[2]:
        notes.append(f"Exception: {r[2]}")
    if "gst" in (overall + r[2]).lower():
        notes.append("GST pending from patient")

    delivery_date = parse_date(r[20]) or parse_date(overall)
    if stage == "Delivered" and not delivery_date:
        delivery_date = None
    last = daily[-1][0] if daily else (delivery_date or "2026-10-14")
    qty, unit, qty_text = parse_qty(r[6])
    n += 1
    rec = {
        "code": f"NPM-{n:04d}",
        "department": "NPP",
        "patient_name": patient or None,
        "patient_reference": f"NPM-R{i}",
        "medicine_name": med or "Not recorded",
        "strength": r[7] or None,
        "quantity": qty, "quantity_unit": unit, "quantity_text": qty_text,
        "hospital_name": None if r[8].lower() in ("", "n/a") else r[8],
        "doctor_name": r[9] or None,
        "owner_name": norm_owner(r[4]),
        "current_stage": stage,
        "status_text": status_text or None,
        "is_foc": is_foc,
        "payment_account": r[12] or None,
        "payment_received_date": parse_date(r[3]),
        "gst_status": "Pending" if "gst" in (overall + r[2]).lower() else "Not applicable",
        "import_permit_date": parse_date(r[11]),
        "cha_name": r[16].title() if r[16] else None,
        "delivery_date": delivery_date if stage == "Delivered" else None,
        "last_activity_at": last,
        "needs_review": bool(notes) and not (stage == "Delivered" and notes == ["Medicine name missing in sheet"]),
        "review_note": "; ".join(notes) or None,
        "source_ref": f"NPP UPDATE / NPM row {i}",
        "history": [[d, t, map_status(t, payment_received)[0]] for d, t in daily],
    }
    emit(rec, "Overall Status" if overall else ("latest daily column" if daily else "Delivery status"))

# ---------------------------------------------------------------- NPP UPDATE / Recordati tab -> RARE_DISEASE
rd = 0
rec_tab = tabs.get("Recordati", [])
for i, r in enumerate(rec_tab[1:], start=2):
    r = r + [""] * (33 - len(r))
    if not r[1]:
        continue
    texts = [x for x in (r[29], r[15], r[12]) if x]
    awb = r[18] or None
    status_text = "; ".join(texts) if texts else ("AWB " + awb if awb else "")
    stage, confident = map_status(r[29] or r[15] or r[12])
    if not texts and awb:
        stage, confident = "Shipped", False
    if stage is None:
        stage, confident = "Inquiry", False
    rd += 1
    qty, unit, qty_text = parse_qty(r[5])
    rec = {
        "code": f"RDM-{rd:04d}",
        "department": "RARE_DISEASE",
        "patient_name": r[1],
        "patient_reference": f"REC-R{i}",
        "medicine_name": r[4] or "Not recorded",
        "quantity": qty, "quantity_unit": unit, "quantity_text": qty_text,
        "manufacturer": "Recordati",
        "current_stage": stage,
        "status_text": status_text or None,
        "awb_number": awb,
        "last_activity_at": "2026-10-14",
        "needs_review": True,
        "review_note": "From the Recordati tab of the NPP sheet; sparse data - confirm stage" + ("" if confident else " (stage guessed)"),
        "source_ref": f"NPP UPDATE / Recordati row {i}",
        "history": [],
    }
    emit(rec, "Recordati tab")

# ---------------------------------------------------------------- Recordati All India Data / TOT Sheet
tot = json.load(open(ROOT / "raw" / "tot.json"))["values"]  # TOT Sheet!A1:Z400
tot_rows = [(k + 1, r) for k, r in enumerate(tot)][1:]  # skip header row
seen_tot = set()
for rowno, r in tot_rows:
    r = r + [""] * (26 - len(r))
    if not any(clean(c) for c in r[1:23]):
        continue
    if rowno in seen_tot:
        continue
    seen_tot.add(rowno)
    lower = [clean(c).lower() for c in r]
    pay, ip, cdec, customs, delivery = lower[18], lower[15], lower[17], lower[19], lower[21]
    cands = []
    if pay in ("recieved", "received", "institutional order", "rotaional order"):
        cands.append("Payment received")
    if ip in ("recieved", "received"):
        cands.append("Import permit")
    if cdec in ("applied", "in progress", "pending"):
        cands.append("CDEC form signed")
    if cdec == "received":
        cands.append("CDEC approved")
    if customs.startswith("under process"):
        cands.append("In customs")
    if customs == "cleared":
        cands.append("Cleared")
    if delivery == "delivered":
        cands.append("Delivered")
    stage = stage_max(*cands) or "Inquiry"
    order_date = parse_date(r[2])
    end_date = parse_date(r[22])
    notes = []
    archive_reason = None
    if stage != "Delivered" and order_date and order_date < "2026-01-01":
        archive_reason = "Legacy 2025 order with no final delivery status in the TOT sheet (auto-archived on import)"
    if not clean(r[5]):
        notes.append("Medicine name missing in sheet")
    if delivery == "pending":
        notes.append("Delivery status 'Pending' in sheet")
    if not order_date:
        notes.append("Order date missing")
    qty, unit, qty_text = parse_qty(r[7])
    rd += 1
    status_bits = [f"{lbl}: {clean(r[c])}" for lbl, c in (("Payment", 18), ("Import permit", 15), ("CDEC", 17), ("Customs", 19), ("Delivery", 21)) if clean(r[c])]
    rec = {
        "code": f"RDM-{rd:04d}",
        "department": "RARE_DISEASE",
        "patient_name": clean(r[9]) or None,
        "patient_reference": f"TOT-{clean(r[0]) or rowno}",
        "medicine_name": clean(r[5]) or "Not recorded",
        "quantity": qty, "quantity_unit": unit, "quantity_text": qty_text,
        "hospital_name": clean(r[10]) or None,
        "owner_name": norm_owner(r[3]),
        "region": clean(r[4]) or None,
        "manufacturer": clean(r[8]) or None,
        "current_stage": stage,
        "status_text": "; ".join(status_bits) or None,
        "awb_number": clean(r[25]) or None,
        "order_placed_date": order_date,
        "delivery_date": end_date if stage == "Delivered" else None,
        "payment_account": "Institutional order" if pay == "institutional order" else None,
        "last_activity_at": (end_date if stage == "Delivered" and end_date else order_date) or "2026-10-14",
        "needs_review": bool(notes) and not archive_reason,
        "review_note": "; ".join(notes) or None,
        "archive_reason": archive_reason,
        "notes": clean(r[24]) or None,
        "source_ref": f"Recordati All India Data / TOT Sheet row {rowno}",
        "history": [],
    }
    emit(rec, "TOT milestone columns")

# Compact positional payload: {"cols": [...], "rows": [[...], ...]}
for rec in rows_out:
    if rec["current_stage"] == "Delivered":
        rec["history"] = []  # delivered: final text kept in status_text, daily noise dropped
        if rec["source_ref"].startswith("Recordati All India"):
            rec["status_text"] = None  # milestone summary is redundant once delivered
    rec["source_ref"] = (rec["source_ref"].replace("NPP UPDATE / ", "NPP:").replace("Recordati All India Data / TOT Sheet row ", "TOT:")
                         .replace("NPM row ", "NPM:").replace("Recordati row ", "REC:"))
    rec.pop("patient_reference", None)  # rebuilt server-side from source_ref
    if rec.get("status_text") and len(rec["status_text"]) > 200:
        rec["status_text"] = rec["status_text"][:197] + "..."
cols = sorted({k for rec in rows_out for k, v in rec.items() if v not in (None, [], False)} | {"needs_review"})
payload = {"cols": cols, "rows": [[rec.get(c) if rec.get(c) not in ([], False) else None for c in cols] for rec in rows_out]}
for row in payload["rows"]:
    i = cols.index("needs_review"); row[i] = 1 if row[i] else 0
    if "is_foc" in cols:
        j = cols.index("is_foc"); row[j] = 1 if row[j] else 0
(OUT / "import.json").write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
with open(OUT / "review.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(review[0].keys()))
    w.writeheader()
    w.writerows(review)

from collections import Counter
print("rows:", len(rows_out))
print("by dept:", Counter(r["department"] for r in rows_out))
print("by stage:", Counter(r["current_stage"] for r in rows_out))
print("needs review:", sum(r["needs_review"] for r in rows_out))
print("archived:", sum(1 for r in rows_out if r.get("archive_reason")))
print("payload bytes:", (OUT / "import.json").stat().st_size)
