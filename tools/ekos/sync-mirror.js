// sync-mirror.js — pull trimmed Ekos EDW tables into out/ekos-mirror.sqlite.
// Prereqs: Ekos VPN connected; PowerShell + SqlServer module (token via Get-EkosToken.ps1).
// Usage: npm run sync

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const { DatabaseSync } = require('node:sqlite'); // built into Node >= 24, no native build needed

const SERVER = 'sql-ekos-rpt.database.windows.net';
const DATABASE = 'SpindletapBrewery_rpt';
const OUT_DIR = path.join(__dirname, 'out');
const DB_PATH = path.join(OUT_DIR, 'ekos-mirror.sqlite');

// Table spec: mirror name -> source query. Trim wide facts to the columns the
// chatbot needs; small dims come over whole. RowStatus filters drop deleted rows
// where the semantics are known (facts); dims keep everything so joins never dangle.
const TABLES = {
  // --- dimensions (small, take all columns) ---
  dim_product: 'SELECT * FROM edw.DimProduct',
  dim_product_style: 'SELECT * FROM edw.DimProductStyle',
  dim_product_type: 'SELECT * FROM edw.DimProductType',
  dim_item: 'SELECT * FROM edw.DimItem',
  dim_item_class: 'SELECT * FROM edw.DimItemClass',
  dim_packaging_type: 'SELECT * FROM edw.DimPackagingType',
  dim_inventory_location: 'SELECT * FROM edw.DimInventoryLocation',
  dim_company: `SELECT CompanyId, CompanyName, CompanyTypeId, IsTaproomFlag, RegionID,
      CompanyBillingCity, CompanyBillingState, SalesPersonID, RowStatus
    FROM edw.DimCompany`,
  dim_company_type: 'SELECT * FROM edw.DimCompanyType',
  dim_adjustment_reason: 'SELECT * FROM edw.DimAdjustmentReason',
  dim_unit_of_measure: 'SELECT * FROM edw.DimUnitOfMeasure',
  dim_unit_of_measure_type: 'SELECT * FROM edw.DimUnitOfMeasureType',
  dim_site: 'SELECT * FROM edw.DimSite',

  // --- facts (trimmed) ---
  fact_batch: 'SELECT * FROM edw.FactBatch',
  fact_inventory_item: `SELECT InventoryItemId, ItemId, InventoryLocationId, SiteId,
      InventoryItemQuantity, InventoryItemBarrels, InventoryItemTotalCost, InventoryItemTotalValue,
      InventoryItemTransactionDate, InventoryItemExpireDate, InventoryItemLastModifiedDate,
      UnitOfMeasureId, UnitOfMeasureTypeID, InventoryItemRowStatus
    FROM edw.FactInventoryItem`,
  fact_invoice: `SELECT InvoiceId, InvoiceNumber, InvoiceOrderDate, InvoiceStatusId, CompanyId,
      SalespersonId, SiteId, InvoiceSubTotal, InvoiceGrossTotal, InvoiceSalesTaxAmount,
      InvoiceItemId, ProductId, ItemId, Quantity, UnitPrice, InvoiceItemSubtotal, Discount,
      GrossPrice, VolumeBarrels, CaseEquivalentUnits, TaxAmount,
      InvoiceRowStatus, InvoiceItemRowStatus
    FROM edw.FactInvoiceHistory`,
  fact_adjustment: `SELECT AdjustmentId, AdjustmentTransactionDate, ItemId, InventoryItemId,
      AdjustmentReasonId, AdjustmentQuantity, AdjustmentQuantityBefore, AdjustmentQuantityAfter,
      InventoryLocationId, AdjustmentCOGS, BatchId, InvoiceId, InventoryReceiptId,
      AdjustmentRowStatus
    FROM edw.FactInventoryAdjustmentHistory`,
  fact_receipt: `SELECT InventoryReceiptId, InventoryReceiptItemId, InventoryReceiptReceivedDate,
      InventoryReceiptStatusId, CompanyId, InventoryReceiptTotalCost, InventoryReceiptReferenceNumber,
      ItemId, InventoryReceiptItemQuantity, QuantityUnitOfMeasureId, InventoryLocationId,
      CostPer, LandedCostPer, BillDueDate, InventoryReceiptRowStatus, InventoryReceiptItemRowStatus
    FROM edw.FactInventoryReceiptHistory`,
  fact_purchase_order: `SELECT PurchaseOrderId, PurchaseOrderNumber, PurchaseOrderDate,
      PurchaseOrderStatus, CompanyId, TotalCost, ExpectedDeliveryDate, SiteId,
      PurchaseOrderItemId, ItemId, QuantityOrdered, QuantityOrderedUnitOfMeasureId,
      CostPer, TotalItemCost, QuantityReceived, PurchaseOrderRowStatus, PurchaseOrderItemRowStatus
    FROM edw.FactPurchaseOrderHistory`,
};

function getToken() {
  const script = path.join(__dirname, 'Get-EkosToken.ps1');
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const token = out.trim().split(/\r?\n/).pop();
  if (!token || token.length < 100) throw new Error('Failed to obtain access token');
  return token;
}

function sqliteType(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  if (typeof value === 'boolean') return 'INTEGER';
  return 'TEXT';
}

function coerce(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpPath = DB_PATH + '.tmp';
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

  console.log('Acquiring access token...');
  const token = getToken();

  console.log('Connecting to EDW...');
  const pool = await sql.connect({
    server: SERVER,
    database: DATABASE,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-access-token', options: { token } },
    requestTimeout: 300000,
  });

  const db = new DatabaseSync(tmpPath);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');

  const counts = {};
  for (const [name, query] of Object.entries(TABLES)) {
    process.stdout.write(`  ${name} ... `);
    const result = await pool.request().query(query);
    const rows = result.recordset;
    counts[name] = rows.length;
    if (rows.length === 0) { console.log('0 rows (skipped)'); continue; }

    const cols = Object.keys(rows[0]);
    const colDefs = cols.map((c) => {
      const sample = rows.find((r) => r[c] !== null && r[c] !== undefined);
      return `"${c}" ${sample ? sqliteType(sample[c]) : 'TEXT'}`;
    });
    db.exec(`DROP TABLE IF EXISTS "${name}"; CREATE TABLE "${name}" (${colDefs.join(', ')});`);
    const insert = db.prepare(
      `INSERT INTO "${name}" VALUES (${cols.map(() => '?').join(', ')})`
    );
    db.exec('BEGIN');
    for (const r of rows) insert.run(...cols.map((c) => coerce(r[c])));
    db.exec('COMMIT');
    console.log(`${rows.length} rows`);
  }
  await pool.close();

  db.exec(`DROP TABLE IF EXISTS sync_meta;
    CREATE TABLE sync_meta (synced_at TEXT, table_name TEXT, row_count INTEGER);`);
  const metaInsert = db.prepare('INSERT INTO sync_meta VALUES (?, ?, ?)');
  const syncedAt = new Date().toISOString();
  for (const [name, count] of Object.entries(counts)) metaInsert.run(syncedAt, name, count);

  // Helpful indexes for the chatbot's common query shapes
  db.exec(`
    CREATE INDEX idx_invoice_date ON fact_invoice (InvoiceOrderDate);
    CREATE INDEX idx_invoice_product ON fact_invoice (ProductId);
    CREATE INDEX idx_invoice_company ON fact_invoice (CompanyId);
    CREATE INDEX idx_adj_date ON fact_adjustment (AdjustmentTransactionDate);
    CREATE INDEX idx_adj_reason ON fact_adjustment (AdjustmentReasonId);
    CREATE INDEX idx_adj_item ON fact_adjustment (ItemId);
    CREATE INDEX idx_batch_start ON fact_batch (BatchStartDate);
    CREATE INDEX idx_inv_item ON fact_inventory_item (ItemId);
    CREATE INDEX idx_receipt_date ON fact_receipt (InventoryReceiptReceivedDate);
    CREATE INDEX idx_po_date ON fact_purchase_order (PurchaseOrderDate);
  `);
  db.exec('VACUUM;');
  db.close();

  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  fs.renameSync(tmpPath, DB_PATH);
  const mb = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\nDone. ${DB_PATH} (${mb} MB), synced_at ${syncedAt}`);
  console.log('Row counts:', JSON.stringify(counts, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
