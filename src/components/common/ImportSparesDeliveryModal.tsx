import React, { useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Download,
  ArrowRight,
  RefreshCw,
  Truck,
  Wrench,
  Building2,
  Package,
  Layers,
  Check
} from 'lucide-react';
import { Product, Branch } from '../../types/erp';
import { importSparesDeliveryCsvApi, CsvSpareDeliveryRow } from '../../services/api';
import { useERP } from '../../context/ERPContext';

interface ImportSparesDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingProducts: Product[];
  branches: Branch[];
  onImportComplete: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

interface ValidatedSpareRow {
  rowNumber: number;
  data: CsvSpareDeliveryRow;
  isValid: boolean;
  errors: string[];
  isDuplicateInCsv: boolean;
  isDuplicateInDb: boolean;
  resolvedBranchName: string;
}

export const ImportSparesDeliveryModal: React.FC<ImportSparesDeliveryModalProps> = ({
  isOpen,
  onClose,
  existingProducts,
  branches,
  onImportComplete,
  showToast
}) => {
  const { refreshStock } = useERP();
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [validatedRows, setValidatedRows] = useState<ValidatedSpareRow[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update'>('update');
  const [defaultBranchOverride, setDefaultBranchOverride] = useState<string>('csv');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'invalid'>('all');
  const [isRawTextMode, setIsRawTextMode] = useState(false);
  const [rawText, setRawText] = useState('');

  if (!isOpen) return null;

  // Sample CSV generator for download
  const handleDownloadSample = () => {
    const headers =
      'Spare Part Name,Part Number,Category,Compatible Models,OEM Number,Brand,Unit,HSN Code,Purchase Price,Selling Price,MRP,GST %,Delivered Qty,Delivery Challan No,Delivery Date,Receiving Branch,Supplier Name,Transporter Vehicle,Shelf Location\n';
    const sampleRows = [
      'Rotavator L-Blade Boron Steel (54 Set),SPR-BLD-L54,Rotavator Blades & Fasteners,"Rotavator 7-ft, 8-ft Multi-Speed, 45-65HP Tractor",OEM-ROT-8842,Acme Genuine Spares,Set,8432,4800,6800,7500,12,40,DC-2026-901,2026-09-29,Sampletown,Sample Forge Co,XX-00-AA-0000,Rack RACK-BLD / Bin B-101',
      'Hydraulic Lift Gear Pump High Pressure,SPR-HYD-PUMP-45,Hydraulics & Lift Cylinders,"Mahindra 575 DI, Swaraj 744, Sonalika 750",OEM-HYD-9910,Acme Genuine Spares,Nos,84136020,5400,7600,8200,18,15,DC-2026-901,2026-09-29,Sampletown,Sample Hydraulics Ltd,XX-00-AA-0000,Rack RACK-HYD / Bin H-02',
      'Heavy Duty Tractor PTO Drive Shaft T6 Series,SPR-PTO-T6-900,Engine & Transmission Spares,"Rotavator 6-ft to 8-ft, Post Hole Digger",OEM-PTO-600,Acme Genuine Spares,Piece,84831099,3900,5600,6100,12,25,DC-2026-902,2026-09-29,Exampleville,Sample Implements Ltd,Sample Logistics XX-00-AA-0000,Rack RACK-PTO / Bin P-05',
      'Rotavator Heavy Gearbox Crown Wheel & Pinion Set,SPR-GEAR-CROWN-13,Engine & Transmission Spares,"Rotavator Multi-Speed 7-ft, 45-60HP",OEM-GR-1328,Acme Genuine Spares,Set,84834000,4800,6800,7400,18,10,DC-2026-902,2026-09-29,Exampleville,Sample Gear Works,Sample Logistics XX-00-AA-0000,Rack RACK-GER / Bin G-12',
      'Double Lip Rotary Oil Seal 85x110x12,SPR-SEAL-85110,Hardware & Fasteners,"Rotavator Side Gear Drive, Tiller Axle",OEM-SL-85110,Acme Genuine Spares,Piece,84842000,160,260,300,18,80,DC-2026-903,2026-09-29,Sampletown,Sample Seals & Bearings,Direct Courier Inward,Rack RACK-SL / Bin S-03',
      'High Tensile Rotavator Blade Bolt M12x35 Grade 10.9,SPR-BLT-M12-35,Hardware & Fasteners,"All Rotavator Flanges & Blade Clamps",OEM-BLT-109,Acme Genuine Spares,Kit,73181500,450,650,720,18,50,DC-2026-903,2026-09-29,Sampletown,Sample Fasteners Ltd,Direct Courier Inward,Rack RACK-BLT / Bin B-22'
    ].join('\n');

    const blob = new Blob([headers + sampleRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Acme_Spares_Delivery_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV Parsing helper
  const parseCsvText = (text: string): string[][] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.map((line) => {
      const row: string[] = [];
      let insideQuote = false;
      let currentEntry = '';

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (insideQuote && line[i + 1] === '"') {
            currentEntry += '"';
            i++;
          } else {
            insideQuote = !insideQuote;
          }
        } else if (char === ',' && !insideQuote) {
          row.push(currentEntry.trim());
          currentEntry = '';
        } else {
          currentEntry += char;
        }
      }
      row.push(currentEntry.trim());
      return row;
    });
  };

  // Process rows from CSV content
  const processCsvContent = (content: string) => {
    const parsedRows = parseCsvText(content);
    if (parsedRows.length <= 1) {
      showToast('The CSV file is empty or contains no data rows.', 'error');
      return;
    }

    const headers = parsedRows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const dataRows = parsedRows.slice(1);

    // Dynamic header lookup
    const isAltHeader = (h: string) => h.includes('alternat') || h.includes('alias') || h.includes('othername') || h.includes('localname') || h.includes('alsoknown');
    const idxName = headers.findIndex((h) => !isAltHeader(h) && (h.includes('spare') || h.includes('partname') || h.includes('product') || h.includes('itemname') || h === 'name'));
    const idxAlt = headers.findIndex((h) => isAltHeader(h));
    const idxSub = headers.findIndex((h) => h.includes('subcat'));
    const idxSku = headers.findIndex((h) => h.includes('partnumber') || h.includes('sku') || h.includes('partno') || h.includes('itemnumber') || h.includes('code'));
    const idxCategory = headers.findIndex((h) => !h.includes('sub') && (h.includes('category') || h.includes('cat')));
    const idxModels = headers.findIndex((h) => h.includes('model') || h.includes('compatible') || h.includes('tractor'));
    const idxOem = headers.findIndex((h) => h.includes('oem'));
    const idxBrand = headers.findIndex((h) => h.includes('brand') || h.includes('make'));
    const idxUnit = headers.findIndex((h) => h.includes('unit') || h.includes('uom'));
    const idxHsn = headers.findIndex((h) => h.includes('hsn'));
    const idxPurchase = headers.findIndex((h) => h.includes('purchase') || h.includes('buy') || h.includes('cost') || h.includes('inwardprice'));
    const idxSelling = headers.findIndex((h) => h.includes('selling') || h.includes('sell') || h.includes('rate') || h.includes('price'));
    const idxMrp = headers.findIndex((h) => h.includes('mrp'));
    const idxGst = headers.findIndex((h) => h.includes('gst') || h.includes('tax'));
    const idxQty = headers.findIndex((h) => h.includes('qty') || h.includes('quantity') || h.includes('delivered') || h.includes('inward'));
    const idxChallan = headers.findIndex((h) => h.includes('challan') || h.includes('deliverynote') || h.includes('invoice') || h.includes('dc'));
    const idxDate = headers.findIndex((h) => h.includes('date'));
    const idxBranch = headers.findIndex((h) => h.includes('branch') || h.includes('location') || h.includes('receiving'));
    const idxSupplier = headers.findIndex((h) => h.includes('supplier') || h.includes('vendor') || h.includes('mfg'));
    const idxVehicle = headers.findIndex((h) => h.includes('vehicle') || h.includes('transporter') || h.includes('lorry') || h.includes('carrier'));
    const idxShelf = headers.findIndex((h) => h.includes('shelf') || h.includes('rack') || h.includes('bin'));

    const seenSkus = new Set<string>();
    const seenNames = new Set<string>();
    const existingSkuSet = new Set(existingProducts.map((p) => p.sku.toUpperCase()));
    const existingNameSet = new Set(existingProducts.map((p) => p.name.trim().toLowerCase()));

    const validated: ValidatedSpareRow[] = dataRows.map((row, index) => {
      const rowNum = index + 2;
      const rawName = (idxName !== -1 ? row[idxName] : row[0])?.trim() || '';
      const rawSku = (idxSku !== -1 ? row[idxSku] : (idxName !== -1 && idxName === 0 ? '' : row[1]))?.trim() || '';
      const category = (idxCategory !== -1 ? row[idxCategory] : 'Rotavator Blades & Fasteners')?.trim() || 'Rotavator Blades & Fasteners';
      const models = (idxModels !== -1 ? row[idxModels] : '')?.trim();
      const oem = (idxOem !== -1 ? row[idxOem] : '')?.trim();
      const brand = (idxBrand !== -1 ? row[idxBrand] : 'Acme Genuine Spares')?.trim() || 'Acme Genuine Spares';
      const unit = (idxUnit !== -1 ? row[idxUnit] : 'Piece')?.trim() || 'Piece';
      const hsn = (idxHsn !== -1 ? row[idxHsn] : '8432')?.trim() || '8432';
      const purchaseRaw = idxPurchase !== -1 ? row[idxPurchase]?.replace(/[^0-9.]/g, '') : '0';
      const sellingRaw = idxSelling !== -1 ? row[idxSelling]?.replace(/[^0-9.]/g, '') : '0';
      const mrpRaw = idxMrp !== -1 ? row[idxMrp]?.replace(/[^0-9.]/g, '') : '0';
      const gstRaw = idxGst !== -1 ? row[idxGst]?.replace(/[^0-9.]/g, '') : '12';
      const qtyRaw = idxQty !== -1 ? row[idxQty]?.replace(/[^0-9.]/g, '') : '10';
      const challan = (idxChallan !== -1 ? row[idxChallan] : 'DC-AUTO-INWARD')?.trim() || 'DC-AUTO-INWARD';
      const deliveryDate = (idxDate !== -1 ? row[idxDate] : new Date().toISOString().split('T')[0])?.trim();
      const rawBranch = defaultBranchOverride !== 'csv'
        ? defaultBranchOverride
        : (idxBranch !== -1 ? row[idxBranch] : 'Sampletown')?.trim() || 'Sampletown';
      const supplier = (idxSupplier !== -1 ? row[idxSupplier] : 'Acme Genuine Spares')?.trim();
      const vehicle = (idxVehicle !== -1 ? row[idxVehicle] : 'Direct Branch Delivery')?.trim();
      const shelf = (idxShelf !== -1 ? row[idxShelf] : 'Rack RACK-SPR / Bin B-01')?.trim();

      const errors: string[] = [];

      // Validate Name
      if (!rawName) {
        errors.push('Spare Part Name is required.');
      }

      // Validate Prices & Numbers
      const purchasePrice = parseFloat(purchaseRaw) || 0;
      const sellingPrice = parseFloat(sellingRaw) || 0;
      const mrp = parseFloat(mrpRaw) || Math.round(sellingPrice * 1.15);
      const gstRate = parseInt(gstRaw, 10) || 12;
      const deliveredQty = parseFloat(qtyRaw) || 0;

      // Prices are optional: they can be added later or typed on the bill.
      if (sellingPrice < 0) {
        errors.push('Selling price cannot be negative.');
      }
      if (deliveredQty <= 0) {
        errors.push('Delivered quantity must be at least 1.');
      }

      // Validate Branch
      let resolvedBranchName = rawBranch;
      const matchedBranch = branches.find((b) =>
        b.name.toLowerCase().includes(rawBranch.toLowerCase()) ||
        rawBranch.toLowerCase().includes(b.name.toLowerCase()) ||
        b.city.toLowerCase().includes(rawBranch.toLowerCase()) ||
        b.id.toLowerCase() === rawBranch.toLowerCase()
      );

      if (matchedBranch) {
        resolvedBranchName = matchedBranch.name;
      } else {
        // Fallback to first branch if not matched
        resolvedBranchName = branches[0]?.name || 'Sampletown (Head Branch)';
      }

      // Check duplicates
      let isDuplicateInCsv = false;
      let isDuplicateInDb = false;

      const normalizedSku = rawSku.toUpperCase();
      const normalizedName = rawName.toLowerCase();

      if (rawSku) {
        if (seenSkus.has(normalizedSku)) {
          isDuplicateInCsv = true;
          errors.push(`Duplicate Part Number '${rawSku}' repeated inside this CSV.`);
        } else {
          seenSkus.add(normalizedSku);
        }

        if (existingSkuSet.has(normalizedSku)) {
          isDuplicateInDb = true;
        }
      } else {
        if (seenNames.has(normalizedName)) {
          isDuplicateInCsv = true;
          errors.push(`Duplicate Spare Name '${rawName}' repeated inside this CSV.`);
        } else {
          seenNames.add(normalizedName);
        }

        if (existingNameSet.has(normalizedName)) {
          isDuplicateInDb = true;
        }
      }

      const rowData: CsvSpareDeliveryRow = {
        name: rawName,
        sku: rawSku || `SPR-TCT-${Math.floor(1000 + Math.random() * 9000)}`,
        category,
        compatibleModels: models,
        subcategory: idxSub !== -1 ? (row[idxSub] || '').trim() || undefined : undefined,
        alternateNames: ((idxAlt !== -1 ? row[idxAlt] : '') || '')
          .split(/[;|\n]/)
          .map((n: string) => n.trim())
          .filter(Boolean),
        oemPartNumber: oem,
        brand,
        unit,
        hsnCode: hsn,
        purchasePrice: purchasePrice || Math.round(sellingPrice * 0.7),
        sellingPrice,
        mrp,
        gstRate,
        deliveredQty,
        challanNumber: challan,
        deliveryDate,
        receivingBranch: resolvedBranchName,
        supplierName: supplier,
        transporterOrVehicle: vehicle,
        shelfBinLocation: shelf
      };

      return {
        rowNumber: rowNum,
        data: rowData,
        isValid: errors.length === 0,
        errors,
        isDuplicateInCsv,
        isDuplicateInDb,
        resolvedBranchName
      };
    });

    setValidatedRows(validated);
    setStep('preview');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) processCsvContent(content);
    };
    reader.readAsText(selected);
  };

  const handleRawTextSubmit = () => {
    if (!rawText.trim()) {
      showToast('Please paste valid CSV rows first.', 'warning');
      return;
    }
    processCsvContent(rawText);
  };

  // Execute import
  const handleExecuteImport = async () => {
    const validRowsToImport = validatedRows.filter((r) => r.isValid);
    if (validRowsToImport.length === 0) {
      showToast('No valid spare part rows to import. Please fix errors first.', 'error');
      return;
    }

    setIsSubmitting(true);
    setStep('importing');

    try {
      const itemsPayload = validRowsToImport.map((r) => r.data);
      const res = await importSparesDeliveryCsvApi(itemsPayload, duplicateStrategy);

      if (res.success) {
        showToast(
          `Successfully processed ${res.totalProcessed} spare parts (${res.insertedCount} newly created, ${res.updatedCount} updated). ${res.totalInwardQty || 0} units inwarded to branch stock!`,
          'success'
        );
        // The delivery import writes a stock receipt, so reload products and receipts.
        refreshStock();
        onImportComplete();
        onClose();
      } else {
        showToast('Import failed. Database transaction was safely rolled back.', 'error');
        setStep('preview');
      }
    } catch (err: any) {
      console.error('Import spares failed:', err);
      showToast(err.message || 'Import failed. Database transaction safely rolled back.', 'error');
      setStep('preview');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter preview list
  const filteredPreview = validatedRows.filter((r) => {
    if (previewFilter === 'valid') return r.isValid;
    if (previewFilter === 'invalid') return !r.isValid;
    return true;
  });

  const totalRowsCount = validatedRows.length;
  const validRowsCount = validatedRows.filter((r) => r.isValid).length;
  const invalidRowsCount = totalRowsCount - validRowsCount;
  const existingMatchesCount = validatedRows.filter((r) => r.isDuplicateInDb).length;
  const totalInwardUnitsCount = validatedRows
    .filter((r) => r.isValid)
    .reduce((acc, r) => acc + (r.data.deliveredQty || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800 bg-gradient-to-r from-amber-500/10 via-blue-500/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/20">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Bulk Import Spare Parts & Inward Delivery
                </h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                  Transactional Inward
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Import tractor spare parts, compatibility, pricing, and inward delivery quantities directly into company branch inventory.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* ==========================================
              STEP 1: UPLOAD & SPECIFY BRANCH
             ========================================== */}
          {step === 'upload' && (
            <div className="space-y-3">
              {/* Template & Options Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/40">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200">
                      Standard Spare Parts & Inward Delivery CSV Format
                    </h4>
                    <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-0.5">
                      Supports: Spare Part Name, Part Number/SKU, Category, Compatible Tractor Models, Purchase/Selling Price, Delivered Quantity, Delivery Challan #, and Receiving Branch.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3.5 py-2 text-xs font-bold text-blue-700 shadow-2xs hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-800 dark:text-blue-300 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Sample CSV Template</span>
                </button>
              </div>

              {/* Branch Override Selector */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Receiving Branch Assignment</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <select
                    value={defaultBranchOverride}
                    onChange={(e) => setDefaultBranchOverride(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="csv">Read Receiving Branch from CSV per row (Recommended)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.name}>
                        Assign ALL rows to: {b.name} ({b.city})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500">
                    If your CSV doesn't specify a branch column, all delivered parts will be routed to the selected branch.
                  </p>
                </div>
              </div>

              {/* Upload Drop Zone / Paste Toggle */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Choose Upload Method
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsRawTextMode(!isRawTextMode)}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    {isRawTextMode ? 'Switch to File Drag & Drop' : 'Switch to Paste Raw CSV Text'}
                  </button>
                </div>

                {!isRawTextMode ? (
                  <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-8 text-center transition-colors hover:border-amber-500 hover:bg-amber-50/30 dark:border-slate-700 dark:bg-slate-800/30 dark:hover:border-amber-500 dark:hover:bg-amber-950/20 cursor-pointer">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400 mb-3">
                      <Upload className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      Click to browse or drag and drop your Spares CSV
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      File format: .csv, .txt (up to 5,000 spare rows per batch)
                    </p>
                    <input
                      type="file"
                      accept=".csv, text/csv, text/plain"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="space-y-3">
                    <textarea
                      rows={8}
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      placeholder="Paste CSV rows here including headers...&#10;Spare Part Name,Part Number,Delivered Qty,Selling Price,Receiving Branch,Challan No&#10;Rotavator L-Blade Boron Steel,SPR-BLD-01,50,680,Sampletown,DC-101"
                      className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleRawTextSubmit}
                        className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-500 cursor-pointer"
                      >
                        Parse & Validate CSV Text
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==========================================
              STEP 2: PREVIEW & VALIDATION BREAKDOWN
             ========================================== */}
          {step === 'preview' && (
            <div className="space-y-3">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Rows</span>
                  <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">{totalRowsCount}</p>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 shadow-2xs dark:border-emerald-900/80 dark:bg-emerald-950/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Valid Rows</span>
                  <p className="text-xl font-mono font-bold text-emerald-700 dark:text-emerald-300">{validRowsCount}</p>
                </div>

                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 shadow-2xs dark:border-rose-900/80 dark:bg-rose-950/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">Errors / Invalid</span>
                  <p className="text-xl font-mono font-bold text-rose-700 dark:text-rose-300">{invalidRowsCount}</p>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 shadow-2xs dark:border-amber-900/80 dark:bg-amber-950/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Total Units Inwarded</span>
                  <p className="text-xl font-mono font-bold text-amber-700 dark:text-amber-300">{totalInwardUnitsCount.toLocaleString()}</p>
                </div>
              </div>

              {/* Duplicate Strategy & Inward Behavior Options */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-amber-600" />
                    <span>Duplicate Strategy for Existing Spare Parts ({existingMatchesCount} matched)</span>
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <label
                    className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-all ${
                      duplicateStrategy === 'update'
                        ? 'border-amber-500 bg-white dark:bg-slate-800 shadow-2xs text-slate-900 dark:text-white'
                        : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="spareStrategy"
                      checked={duplicateStrategy === 'update'}
                      onChange={() => setDuplicateStrategy('update')}
                      className="mt-0.5 text-amber-600 focus:ring-amber-500"
                    />
                    <div>
                      <p className="text-xs font-bold">Update & Inward Stock (Recommended)</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Updates price & compatibility for existing part numbers and immediately ADDS the delivered inward quantities to the branch stock.
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-all ${
                      duplicateStrategy === 'skip'
                        ? 'border-amber-500 bg-white dark:bg-slate-800 shadow-2xs text-slate-900 dark:text-white'
                        : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="spareStrategy"
                      checked={duplicateStrategy === 'skip'}
                      onChange={() => setDuplicateStrategy('skip')}
                      className="mt-0.5 text-amber-600 focus:ring-amber-500"
                    />
                    <div>
                      <p className="text-xs font-bold">Skip Existing Parts</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Only create completely new spare parts. Existing part numbers in the database will be ignored.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Table Filter Tabs */}
              <div className="flex items-center justify-between">
                <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('all')}
                    className={`rounded-md px-3 py-1 font-semibold transition-all ${
                      previewFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    All ({totalRowsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('valid')}
                    className={`rounded-md px-3 py-1 font-semibold transition-all ${
                      previewFilter === 'valid'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    Valid ({validRowsCount})
                  </button>
                  {invalidRowsCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setPreviewFilter('invalid')}
                      className={`rounded-md px-3 py-1 font-semibold transition-all ${
                        previewFilter === 'invalid'
                          ? 'bg-rose-600 text-white shadow-2xs'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      Errors ({invalidRowsCount})
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setStep('upload');
                    setValidatedRows([]);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Choose Another CSV</span>
                </button>
              </div>

              {/* Interactive Preview Table */}
              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Spare Part Name & Part #</th>
                      <th className="py-2.5 px-3">Category & Fitment</th>
                      <th className="py-2.5 px-3 text-right">Inward Qty</th>
                      <th className="py-2.5 px-3">Receiving Branch</th>
                      <th className="py-2.5 px-3 text-right">Selling Price</th>
                      <th className="py-2.5 px-3">Challan / Logistics</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredPreview.map((r) => (
                      <tr
                        key={r.rowNumber}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                          !r.isValid ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-mono text-slate-400">{r.rowNumber}</td>
                        <td className="py-2 px-3">
                          {r.isValid ? (
                            r.isDuplicateInDb ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                                Existing Part
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                                <Check className="h-3 w-3" /> New Spare
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950/80 dark:text-rose-300">
                              <AlertCircle className="h-3 w-3" /> Invalid
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <p className="font-bold text-slate-900 dark:text-white">{r.data.name || 'MISSING NAME'}</p>
                          <p className="font-mono text-[10px] text-slate-400">{r.data.sku}</p>
                          {r.errors.length > 0 && (
                            <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-0.5">
                              {r.errors.join(' • ')}
                            </p>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <p className="text-slate-700 dark:text-slate-300">{r.data.category}</p>
                          {r.data.compatibleModels && (
                            <p className="text-[10px] text-slate-400 truncate max-w-xs">{r.data.compatibleModels}</p>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300">
                          +{r.data.deliveredQty} {r.data.unit}
                        </td>
                        <td className="py-2 px-3 font-semibold text-blue-700 dark:text-blue-300">
                          {r.resolvedBranchName}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                          ₹{r.data.sellingPrice?.toLocaleString()}
                        </td>
                        <td className="py-2 px-3">
                          <p className="font-mono text-[11px] font-bold text-slate-800 dark:text-slate-200">
                            {r.data.challanNumber || 'DC-INWARD'}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {r.data.transporterOrVehicle || 'Direct Delivery'}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==========================================
              STEP 3: IMPORTING SPINNER
             ========================================== */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="relative">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-amber-200 border-t-amber-600 dark:border-amber-950 dark:border-t-amber-400" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Truck className="h-6 w-6 text-amber-600 dark:text-amber-400 animate-pulse" />
                </div>
              </div>
              <div className="text-center">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Executing Safe SQL Transaction...
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Registering spare parts, updating centralized prices, and logging delivery inward quantities into branch inventory with automatic rollback protection.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">
            {step === 'preview' && (
              <span>
                {validRowsCount} of {totalRowsCount} rows ready for database transaction
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>

            {step === 'preview' && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={validRowsCount === 0 || isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-500 active:scale-98 cursor-pointer disabled:opacity-50"
              >
                <span>Confirm & Inward Spares Delivery ({validRowsCount})</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
