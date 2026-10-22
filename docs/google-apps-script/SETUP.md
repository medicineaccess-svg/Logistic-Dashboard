# Google Sheet ⇄ Control Tower sync — setup (about 5 minutes per sheet)

Do this once in the **NPP sheet** and once in the **Recordati (TOT) sheet**, signed in with the Google
account that owns the sheets.

1. Open the sheet → **Extensions → Apps Script**.
2. Delete anything in `Code.gs`, paste the full contents of [`Code.gs`](./Code.gs), click **Save**.
3. **Deploy → New deployment** → gear icon → **Web app**
   - Description: `Control Tower sync`
   - Execute as: **Me**
   - Who has access: **Anyone** (the script refuses every call without the sync secret)
   - Click **Deploy**, approve the Google permission screens (Advanced → Go to project → Allow).
   - Copy the **Web app URL** (ends with `/exec`).
4. Go back to the sheet and reload the page. A new menu **Ikris Control Tower** appears.
5. **Ikris Control Tower → Connect to dashboard (one-time setup)**
   - Paste the sync secret (ask the admin; it is stored only in this script's Script Properties).
   - Paste the Web app URL from step 3.
6. The first full sync runs straight away and shows a summary.

## What happens after setup

| When | What |
|---|---|
| Anyone edits a row in **NPM** / **TOT Sheet** | The row is sent to the dashboard within seconds (stage, payment, hospital, doctor, AWB…). |
| Every 10 minutes | Full sync of the tab, plus refresh of the **CT Export (Supabase)** tab. |
| Someone clicks **Sync sheet** in the dashboard | Full sync on demand. |
| Dashboard update (stage, payment, hold…) | Shown in the sheet's **CT Stage (dashboard)** / **CT Last update** columns and the CT Export tab at the next sync. |
| Someone picks a stage in the **CT Stage (dashboard)** dropdown | The dashboard is set to exactly that stage (forward or back) within seconds. |

Three columns are added at the right end of the tab: **CT Shipment ID**, **CT Stage (dashboard)**, **CT Last update**.
Please don't edit or delete them; the shipment ID is what keeps each sheet row tied to the same shipment
even if rows are sorted, inserted or deleted. New date columns (e.g. `22/10/26`) can be added anywhere.

### Rules the sync follows
- Columns are found by **header name**, so adding, moving or deleting other columns is safe.
- **Payment status** is copied exactly: "Received" shows as Received, "Not Received" / "Pending" shows as Unpaid.
  If a shipment is at Payment received only because of payment and the sheet changes to Not Received, it goes back to Inquiry.
- **Payment received date** comes only from the sheet's own date column — no date is invented.
- The stage is read from the newest dated status column (e.g. `21/10/26`); "Delivered" anywhere wins.
  Free text can only move a shipment **forward**. If the newest text points to an earlier stage, the shipment
  is flagged **Needs review** (with the sheet text) instead of being guessed.
- To set a stage exactly — forward or back — pick it in the **CT Stage (dashboard)** dropdown.
- A milestone date is filled only from the sheet (the dated column it was read from, or the delivery date).
- A new row with a patient name creates a new shipment (NPM-xxxx / RDM-xxxx).

### Re-deploying after a script change
Deploy → **Manage deployments** → edit (pencil) → Version: **New version** → Deploy. The URL stays the same.
