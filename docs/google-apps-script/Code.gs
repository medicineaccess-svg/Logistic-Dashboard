/**
 * Ikris Logistics Control Tower <-> Google Sheet sync
 *
 * Install once in EACH sheet (NPP sheet and Recordati sheet): Extensions > Apps Script,
 * paste this whole file, save, then follow docs/google-apps-script/SETUP.md.
 *
 * What it does
 *  - Any edit in the team tab (NPM / TOT Sheet) is sent to the dashboard within seconds.
 *  - Every 10 minutes a full sync runs (catches pasted rows, imports, edits by other scripts).
 *  - "Sync with Google Sheet" in the dashboard calls this script's web app to run a sync on demand.
 *  - Three columns are kept at the end of the team tab: CT Shipment ID, CT Stage (dashboard), CT Last update.
 *    "CT Stage (dashboard)" is a dropdown: picking a stage there sets exactly that stage in the dashboard.
 *  - The "CT Export (Supabase)" tab is refreshed with the full dashboard data (stage, payments, alerts...).
 *
 * No Google credentials are stored in Supabase. The only secret is the shared SYNC secret,
 * kept in this script's Script Properties (never in the code).
 */

const EDGE_URL = 'https://mmqesztrrwmmqiuadvyi.supabase.co/functions/v1/sheet-sync';
const SHEETS = {
  '1bXcW_7zLdfid1vYet5V2WHsfEuTpi4Y8DFgm_Pgt55c': { dept: 'NPP', tab: 'NPM' },
  '10QDCb9yB804afJAxOMvKtWFPNHU7AGwsSLew6vs7lpE': { dept: 'RARE_DISEASE', tab: 'TOT Sheet' }, // Recordati All India Data
};
const MIRROR_TAB = 'CT Export (Supabase)';
const CT_HEADERS = ['CT Shipment ID', 'CT Stage (dashboard)', 'CT Last update'];
const STAGES = ['Inquiry', 'Payment received', 'Import permit', 'CDEC form signed', 'CDEC approved', 'Order placed',
  'Shipped', 'In customs', 'Cleared', 'Delivered', 'POD received'];
const HEADER_ROW = 1;

/* ---------------- menu & one-time setup ---------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ikris Control Tower')
    .addItem('Sync now', 'menuSync')
    .addItem('Refresh CT Export tab', 'menuMirror')
    .addSeparator()
    .addItem('Connect to dashboard (one-time setup)', 'connect')
    .addToUi();
}

function connect() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const conf = SHEETS[ss.getId()];
  if (!conf) {
    ui.alert('This spreadsheet is not one of the two logistics sheets. Nothing was changed.');
    return;
  }
  const s = ui.prompt('Connect to Control Tower (1/2)', 'Paste the sync secret you were given:', ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK || !s.getResponseText().trim()) return;
  const u = ui.prompt(
    'Connect to Control Tower (2/2)',
    'Paste the Web app URL (Deploy > Manage deployments > Web app URL, ends with /exec):',
    ui.ButtonSet.OK_CANCEL,
  );
  if (u.getSelectedButton() !== ui.Button.OK) return;
  const url = u.getResponseText().trim();

  const props = PropertiesService.getScriptProperties();
  props.setProperties({ SYNC_SECRET: s.getResponseText().trim(), SHEET_ID: ss.getId() });

  const reg = callEdge_({ action: 'register', department: conf.dept, url: url });
  if (!reg.ok) {
    ui.alert('Could not connect: ' + (reg.error || 'unknown error') + '\nCheck the secret and the web app URL, then try again.');
    return;
  }

  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onEditSync').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('scheduledSync').timeBased().everyMinutes(10).create();

  const r = fullSync_('menu', '');
  ui.alert(
    'Connected.\n\n' + summary_(r) + '\n\nEdits in "' + conf.tab + '" now reach the dashboard automatically, ' +
      'a full sync runs every 10 minutes, and the dashboard\'s "Sync with Google Sheet" button works.',
  );
}

function menuSync() {
  const r = fullSync_('menu', '');
  SpreadsheetApp.getUi().alert(r.ok ? 'Sync finished.\n\n' + summary_(r) : 'Sync failed: ' + r.error);
}

function menuMirror() {
  const r = refreshMirror_();
  SpreadsheetApp.getUi().alert(r.ok ? 'CT Export tab refreshed (' + r.count + ' shipments).' : 'Refresh failed: ' + r.error);
}

/* ---------------- triggers ---------------- */

/** Installable onEdit: push only the edited rows. */
function onEditSync(e) {
  if (!e || !e.range) return;
  const ctx = ctx_();
  if (!ctx) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== ctx.conf.tab) return;
  const first = Math.max(e.range.getRow(), HEADER_ROW + 1);
  const last = e.range.getLastRow();
  if (last < first) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // a full sync is running; it will pick this up in <10 min
  try {
    const headers = ensureCtColumns_(sh);
    const values = sh.getRange(first, 1, last - first + 1, headers.length).getDisplayValues();
    const rows = values.map((v, i) => ({ row: first + i, values: v }));
    // Did the person edit the CT Stage dropdown? Then that exact stage is applied.
    const stageCol = headers.findIndex((x) => String(x).trim().toLowerCase() === CT_HEADERS[1].toLowerCase()) + 1;
    const c1 = e.range.getColumn();
    const c2 = e.range.getLastColumn();
    const stageRows = stageCol > 0 && stageCol >= c1 && stageCol <= c2 ? rows.map((r) => r.row) : [];
    const res = callEdge_({ action: 'push', department: ctx.conf.dept, trigger: 'sheet_edit', headers: headers, rows: rows, stage_rows: stageRows });
    if (res.ok) writeCt_(sh, headers, res.results);
  } finally {
    lock.releaseLock();
  }
}

function scheduledSync() {
  fullSync_('scheduled', '');
}

/** Web app endpoint used by the dashboard's "Sync with Google Sheet" button. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET') || '';
  if (!secret || p.token !== secret) return out_({ ok: false, error: 'unauthorised' });
  if (p.action !== 'sync') return out_({ ok: false, error: 'unknown action' });
  const by = /^[0-9a-f-]{36}$/.test(p.by || '') ? p.by : '';
  return out_(fullSync_('manual', by));
}

/* ---------------- core ---------------- */

function fullSync_(trigger, by) {
  const ctx = ctx_();
  if (!ctx) return { ok: false, error: 'Sheet not connected. Use Ikris Control Tower > Connect.' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return { ok: false, error: 'Another sync is running. Try again in a minute.' };
  try {
    const sh = ctx.ss.getSheetByName(ctx.conf.tab);
    if (!sh) return { ok: false, error: 'Tab "' + ctx.conf.tab + '" not found.' };
    const headers = ensureCtColumns_(sh);
    const lastRow = sh.getLastRow();
    if (lastRow <= HEADER_ROW) return { ok: true, stats: {} };
    const values = sh.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, headers.length).getDisplayValues();
    const rows = values.map((v, i) => ({ row: HEADER_ROW + 1 + i, values: v }));
    const res = callEdge_({ action: 'push', department: ctx.conf.dept, trigger: trigger, triggered_by: by || undefined, headers: headers, rows: rows });
    if (!res.ok) return res;
    writeCt_(sh, headers, res.results);
    const m = refreshMirror_();
    return { ok: true, stats: res.stats, mirror: m.ok ? m.count : 0 };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}

function refreshMirror_() {
  const ctx = ctx_();
  if (!ctx) return { ok: false, error: 'not connected' };
  const res = callEdge_({ action: 'mirror', department: ctx.conf.dept });
  if (!res.ok) return res;
  let sh = ctx.ss.getSheetByName(MIRROR_TAB);
  if (!sh) sh = ctx.ss.insertSheet(MIRROR_TAB);
  sh.clearContents();
  const data = [res.header].concat(res.rows);
  sh.getRange(1, 1, data.length, res.header.length).setValues(data);
  sh.getRange(1, 1, 1, res.header.length).setFontWeight('bold').setBackground('#EAF1F8').setFontColor('#193153');
  sh.setFrozenRows(1);
  sh.getRange(1, 1).setNote('Read-only copy of the Control Tower dashboard. Refreshed ' + res.refreshed + ' IST. Edits here are overwritten.');
  return { ok: true, count: res.rows.length };
}

/** Make sure the 3 CT columns exist at the end of the team tab; returns the header row. */
function ensureCtColumns_(sh) {
  ensureStageDropdown_(sh);
  let lastCol = sh.getLastColumn();
  let headers = sh.getRange(HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
  const norm = (h) => String(h).trim().toLowerCase();
  const missing = CT_HEADERS.filter((h) => !headers.some((x) => norm(x) === norm(h)));
  if (missing.length) {
    sh.getRange(HEADER_ROW, lastCol + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#EAF1F8').setFontColor('#193153');
    sh.getRange(HEADER_ROW, lastCol + 1).setNote('Filled by the Ikris Control Tower. Please do not edit the CT columns.');
    lastCol += missing.length;
    headers = sh.getRange(HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
    try {
      const idCol = headers.findIndex((x) => norm(x) === norm(CT_HEADERS[0])) + 1;
      sh.getRange(1, idCol, sh.getMaxRows(), 1).protect().setDescription('Control Tower ID column').setWarningOnly(true);
    } catch (e) {
      /* protection is optional */
    }
  }
  return headers;
}

/** CT Stage column = dropdown of the 11 stages (added once). */
function ensureStageDropdown_(sh) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('DROPDOWN_V1') === sh.getSheetId() + '') return;
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
  const col = headers.findIndex((x) => String(x).trim().toLowerCase() === CT_HEADERS[1].toLowerCase()) + 1;
  if (col <= 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STAGES, true).setAllowInvalid(false)
    .setHelpText('Pick the correct stage. The dashboard will be set to exactly this stage.').build();
  sh.getRange(HEADER_ROW + 1, col, Math.max(sh.getMaxRows() - HEADER_ROW, 1), 1).setDataValidation(rule);
  // Keep only the Shipment ID column protected, so the stage dropdown can be used without a warning.
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach((p) => {
    if (p.getDescription() === 'Control Tower columns') p.remove();
  });
  try {
    sh.getRange(1, col - 1, sh.getMaxRows(), 1).protect().setDescription('Control Tower ID column').setWarningOnly(true);
  } catch (err) {
    /* optional */
  }
  sh.getRange(HEADER_ROW, col).setNote('Dropdown: pick a stage here to set it in the dashboard (forward or back).');
  props.setProperty('DROPDOWN_V1', sh.getSheetId() + '');
}

function writeCt_(sh, headers, results) {
  if (!results || !results.length) return;
  const norm = (h) => String(h).trim().toLowerCase();
  const idx = CT_HEADERS.map((h) => headers.findIndex((x) => norm(x) === norm(h)) + 1);
  if (idx.some((i) => i <= 0)) return;
  const contiguous = idx[1] === idx[0] + 1 && idx[2] === idx[0] + 2;
  const minRow = Math.min.apply(null, results.map((r) => r.row));
  const maxRow = Math.max.apply(null, results.map((r) => r.row));
  const n = maxRow - minRow + 1;
  const byRow = {};
  results.forEach((r) => (byRow[r.row] = [r.code, r.stage, r.updated]));
  if (contiguous) {
    const rng = sh.getRange(minRow, idx[0], n, 3);
    const cur = rng.getValues();
    for (let i = 0; i < n; i++) if (byRow[minRow + i]) cur[i] = byRow[minRow + i];
    rng.setValues(cur);
  } else {
    for (let c = 0; c < 3; c++) {
      const rng = sh.getRange(minRow, idx[c], n, 1);
      const cur = rng.getValues();
      for (let i = 0; i < n; i++) if (byRow[minRow + i]) cur[i] = [byRow[minRow + i][c]];
      rng.setValues(cur);
    }
  }
}

/* ---------------- helpers ---------------- */

function ctx_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (!id || !props.getProperty('SYNC_SECRET') || !SHEETS[id]) return null;
  return { ss: SpreadsheetApp.openById(id), conf: SHEETS[id] };
}

function callEdge_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET') || '';
  const res = UrlFetchApp.fetch(EDGE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sync-secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  let body;
  try {
    body = JSON.parse(res.getContentText());
  } catch (e) {
    return { ok: false, error: 'Unexpected response (' + res.getResponseCode() + ')' };
  }
  if (res.getResponseCode() >= 300) return { ok: false, error: body.error || 'HTTP ' + res.getResponseCode() };
  return body;
}

function summary_(r) {
  if (!r || !r.stats) return '';
  const s = r.stats;
  return [
    'New shipments: ' + (s.created || 0),
    'Updated: ' + (s.updated || 0),
    'No change: ' + (s.unchanged || 0),
    'Flagged for review: ' + (s.flagged || 0),
  ].join('\n');
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
