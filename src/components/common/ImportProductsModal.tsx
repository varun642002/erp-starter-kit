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
  SlidersHorizontal
} from 'lucide-react';
import { Product } from '../../types/erp';
import { importProductsCsvApi, CsvProductRow } from '../../services/api';
import { useERP } from '../../context/ERPContext';

interface ImportProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingProducts: Product[];
  onImportComplete: () => void;
  // machinery: every row is a machine; spares: every row is a spare part. Both default opening stock to 0.
  mode?: 'products' | 'machinery' | 'spares';
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

interface ValidatedRow {
  rowNumber: number;
  data: CsvProductRow;
  isValid: boolean;
  errors: string[];
  isDuplicateInCsv: boolean;
  isDuplicateInDb: boolean;
}

export const ImportProductsModal: React.FC<ImportProductsModalProps> = ({
  isOpen,
  onClose,
  existingProducts,
  onImportComplete,
  mode = 'products',
  showToast
}) => {
  const isMachinery = mode === 'machinery';
  const isSpares = mode === 'spares';
  const { refreshProducts } = useERP();
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update'>('skip');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Sample CSV generator for download
  const handleDownloadSample = () => {
    if (isSpares) {
      const sh = 'Item Number,Product Name,Category,HSN Code,Brand,Unit,GST %,Selling Price,Purchase Price,MRP,Initial Stock,Min Stock,Compatible Models,Description,Alternate Names,Part Number,Sub Category\n';
      const srows = [
        'SPR-BLD-001,Rotavator Blade L-Type,Rotavator Blades & Fasteners,,,Piece,,,,,0,10,Rotavator 7-ft,,"Rotary blade; ரோட்டவேட்டர் பிளேடு",RT-L-001,Blades',
        'SPR-BRG-002,Gearbox Bearing 6205,Bearings & Seals,,,Piece,,,,,0,10,Rotavator,,"Bearing 6205; பேரிங்",6205-2RS,Ball bearings'
      ].join('\n');
      const sblob = new Blob([sh + srows], { type: 'text/csv;charset=utf-8;' });
      const surl = URL.createObjectURL(sblob);
      const slink = document.createElement('a');
      slink.href = surl;
      slink.setAttribute('download', 'Spares_Import_Template.csv');
      document.body.appendChild(slink);
      slink.click();
      document.body.removeChild(slink);
      URL.revokeObjectURL(surl);
      return;
    }
    if (isMachinery) {
      const mh = 'Item Number,Product Name,Category,HSN Code,Brand,Unit,GST %,Selling Price,Purchase Price,MRP,Initial Stock,Min Stock,Compatible Models,Description,Alternate Names,Part Number,Sub Category\n';
      const mrows = [
        'ACM-AT40,Acme AT40 Rotary Tiller (GES & HD Series),Rotavator,8432,Acme,Nos,5,,,,0,1,40-50 HP tractor,"Working width 1500 mm; 36 blades; weight 402 Kgs","Rotary tiller; ரோட்டவேட்டர்",GES40MSG,Rotary tillers',
        'ACM-AB1000,Acme AB1000 Round Baler (AB Series),Baler,8433,Acme,Nos,5,,,,0,1,35-45 HP tractor (dual clutch must),"Pickup width 1060 mm; bale D-610 x W-930 mm; weight 625 Kgs","Baler; பேலர்",AB1000,Balers'
      ].join('\n');
      const mblob = new Blob([mh + mrows], { type: 'text/csv;charset=utf-8;' });
      const murl = URL.createObjectURL(mblob);
      const mlink = document.createElement('a');
      mlink.href = murl;
      mlink.setAttribute('download', 'Machinery_Import_Template.csv');
      document.body.appendChild(mlink);
      mlink.click();
      document.body.removeChild(mlink);
      URL.revokeObjectURL(murl);
      return;
    }
    const headers =
      'Item Number,Product Name,HSN Number,Category,Brand,Unit,GST %,Purchase Price,Selling Price,MRP,Min Stock,Initial Stock,OEM Part Number,Compatible Models,Rack Location,Description,Is Spare\n';
    const sampleRows = [
      'PT-00125,Hydraulic Gear Pump (High Pressure),84136020,Hydraulics & Lift Cylinders,Acme Genuine Spares,Nos,18,6500,8800,9500,10,25,OEM-HYD-7721,"Tractor 45HP-55HP, Rotavator 7-ft",Rack RACK-HYD / Bin B-201,High pressure dual-stage hydraulic lift pump,true',
      'ROT-7FT-MS,Rotavator 7-ft Multi-Speed Heavy Duty,84328010,Tractor Implements,Acme Implements,Nos,12,85000,115000,122000,4,8,OEM-ROT-7000,"Tractor 50HP-65HP, PTO 540 RPM",Branch Shelf S-101,Heavy duty 7 feet soil preparation rotavator with 54 blades,false',
      'SPR-BLD-901,Rotavator L-Type Blade Boron Steel,8432,Rotavator Blades & Fasteners,Acme Genuine Spares,Piece,12,480,690,760,50,200,OEM-ROT-8842,"Rotavator 6-ft, 7-ft, 8-ft",Rack RACK-BLD / Bin B-102,Hot forged boron steel heat treated tiller blade,true'
    ].join('\n');

    const blob = new Blob([headers + sampleRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Acme_Products_Sample.csv');
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const parsedRows = parseCsvText(content);
      if (parsedRows.length <= 1) {
        showToast('The uploaded CSV file is empty or missing data rows.', 'error');
        return;
      }

      const headers = parsedRows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const dataRows = parsedRows.slice(1);

      // Find column indices
      const idxSku = headers.findIndex((h) => h.includes('itemnumber') || h.includes('sku') || h.includes('itemcode') || h === 'itemno');
      const isAltHeader = (h: string) => h.includes('alternat') || h.includes('alias') || h.includes('othername') || h.includes('localname') || h.includes('alsoknown');
      const idxName = headers.findIndex((h) => !isAltHeader(h) && (h.includes('productname') || h.includes('name') || h.includes('materialname') || h.includes('itemname')));
      const idxAlt = headers.findIndex((h) => isAltHeader(h));
      const idxHsn = headers.findIndex((h) => h.includes('hsn') || h.includes('hsncode') || h.includes('hsnnumber'));
      const idxCategory = headers.findIndex((h) => !h.includes('sub') && (h.includes('category') || h.includes('cat')));
      const idxSub = headers.findIndex((h) => h.includes('subcat'));
      const idxBrand = headers.findIndex((h) => h.includes('brand') || h.includes('make') || h.includes('mfg'));
      const idxUnit = headers.findIndex((h) => h.includes('unit') || h.includes('uom'));
      const idxGst = headers.findIndex((h) => h.includes('gst') || h.includes('tax') || h.includes('taxrate'));
      const idxPurchase = headers.findIndex((h) => h.includes('purchase') || h.includes('cost') || h.includes('buy'));
      const idxSelling = headers.findIndex((h) => h.includes('selling') || h.includes('sell') || h.includes('rate') || h.includes('price'));
      const idxMrp = headers.findIndex((h) => h.includes('mrp'));
      const idxMinStock = headers.findIndex((h) => h.includes('min') || h.includes('reorder'));
      const idxInitialStock = headers.findIndex((h) => h.includes('initial') || h.includes('stock') || h.includes('qty'));
      const idxOem = headers.findIndex((h) => h.includes('oem') || h.includes('partno'));
      const idxModels = headers.findIndex((h) => h.includes('model') || h.includes('compatible') || h.includes('fitment'));
      const idxRack = headers.findIndex((h) => h.includes('rack') || h.includes('bin') || h.includes('location'));
      const idxDesc = headers.findIndex((h) => h.includes('desc') || h.includes('specification'));
      const idxSpare = headers.findIndex((h) => h.includes('spare') || h.includes('isspare'));

      const seenSkus = new Set<string>();
      const existingSkuSet = new Set(existingProducts.map((p) => p.sku.toUpperCase()));

      const validated: ValidatedRow[] = dataRows.map((row, index) => {
        const rowNum = index + 2;
        const sku = (idxSku !== -1 ? row[idxSku] : row[0])?.trim() || '';
        const name = (idxName !== -1 ? row[idxName] : row[1])?.trim() || '';
        const hsn = (idxHsn !== -1 ? row[idxHsn] : '8432')?.trim();
        const category = (idxCategory !== -1 ? row[idxCategory] : 'Tractor Implements')?.trim();
        const brand = (idxBrand !== -1 ? row[idxBrand] : 'Acme Genuine Spares')?.trim();
        const unit = (idxUnit !== -1 ? row[idxUnit] : 'Nos')?.trim() || 'Nos';
        const gstRaw = idxGst !== -1 ? row[idxGst]?.replace('%', '') : '18';
        const purchaseRaw = idxPurchase !== -1 ? row[idxPurchase]?.replace(/[^0-9.]/g, '') : '0';
        const sellingRaw = idxSelling !== -1 ? row[idxSelling]?.replace(/[^0-9.]/g, '') : '0';
        const mrpRaw = idxMrp !== -1 ? row[idxMrp]?.replace(/[^0-9.]/g, '') : '0';
        const minRaw = idxMinStock !== -1 ? row[idxMinStock]?.replace(/[^0-9]/g, '') : '10';
        const stockRaw = idxInitialStock !== -1 ? row[idxInitialStock]?.replace(/[^0-9]/g, '') : isMachinery || isSpares ? '0' : '20';
        const oem = idxOem !== -1 ? row[idxOem]?.trim() : '';
        const models = idxModels !== -1 ? row[idxModels]?.trim() : '';
        const rack = idxRack !== -1 ? row[idxRack]?.trim() : '';
        const desc = idxDesc !== -1 ? row[idxDesc]?.trim() : '';
        const isSpareRaw = idxSpare !== -1 ? row[idxSpare]?.toLowerCase().trim() : '';
        const subcategory = idxSub !== -1 ? (row[idxSub] || '').trim() : '';
        const altRaw = idxAlt !== -1 ? row[idxAlt] || '' : '';
        const alternateNames = altRaw
          .split(/[;|\n]/)
          .map((n: string) => n.trim())
          .filter(Boolean);
        const isSpare = isMachinery
          ? false
          : isSpares
          ? true
          : isSpareRaw === 'true' || isSpareRaw === '1' || isSpareRaw === 'yes' || sku.startsWith('SPR-');

        const errors: string[] = [];

        // Validation Checks
        if (!sku) errors.push('Missing required Item Number / SKU');
        if (!name) errors.push('Missing required Product Name');

        const purchasePrice = parseFloat(purchaseRaw) || 0;
        const sellingPrice = parseFloat(sellingRaw) || 0;
        const gstRate = parseInt(gstRaw, 10) || 18;

        if (isNaN(purchasePrice) || purchasePrice < 0) errors.push('Invalid Purchase Price');
        // Selling price is optional: it can be entered when the item is billed.
        if (isNaN(sellingPrice) || sellingPrice < 0) errors.push('Invalid Selling Price');
        if (isNaN(gstRate) || gstRate < 0 || gstRate > 28) errors.push('GST % must be between 0 and 28');

        // Check in-file duplicate
        const upperSku = sku.toUpperCase();
        const isDuplicateInCsv = seenSkus.has(upperSku);
        if (upperSku) seenSkus.add(upperSku);
        if (isDuplicateInCsv) errors.push(`Duplicate Item Number "${sku}" found within CSV`);

        // Check database duplicate
        const isDuplicateInDb = existingSkuSet.has(upperSku);
        if (isDuplicateInDb && (isMachinery || isSpares)) {
          const there = existingProducts.find((p) => p.sku.toUpperCase() === upperSku);
          if (there && Boolean(there.isSparePart) !== isSpare) {
            errors.push(
              there.isSparePart
                ? `"${sku}" is already a spare part, so it cannot be added to Machinery.`
                : `"${sku}" is already machinery, so it cannot be added to Spares.`
            );
          }
        }

        return {
          rowNumber: rowNum,
          data: {
            sku,
            name,
            hsnCode: hsn || '8432',
            category: category || 'Tractor Implements',
            brand: brand || 'Acme Genuine Spares',
            unit,
            gstRate,
            purchasePrice,
            sellingPrice,
            mrp: parseFloat(mrpRaw) || Math.round(sellingPrice * 1.1),
            minStock: parseInt(minRaw, 10) || 10,
            initialStock: parseInt(stockRaw, 10) || 0,
            oemPartNumber: oem || undefined,
            compatibleModels: models || undefined,
            shelfBinLocation: rack || undefined,
            description: desc || undefined,
            alternateNames: alternateNames.length ? alternateNames : undefined,
            subcategory: subcategory || undefined,
            isSparePart: isSpare
          },
          isValid: errors.length === 0,
          errors,
          isDuplicateInCsv,
          isDuplicateInDb
        };
      });

      setValidatedRows(validated);
      setStep('preview');
    };
    reader.readAsText(selected);
  };

  const validCount = validatedRows.filter((r) => r.isValid).length;
  const invalidCount = validatedRows.filter((r) => !r.isValid).length;
  const dbDuplicateCount = validatedRows.filter((r) => r.isValid && r.isDuplicateInDb).length;

  const handleConfirmImport = async () => {
    const validData = validatedRows.filter((r) => r.isValid).map((r) => r.data);
    if (validData.length === 0) {
      showToast('No valid rows available to import.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await importProductsCsvApi(validData, duplicateStrategy);
      showToast(
        `Import Complete: ${res.insertedCount} inserted, ${res.updatedCount} updated, ${res.skippedCount} skipped.`,
        'success'
      );
      if (res.sectionConflicts && res.sectionConflicts.length > 0) {
        showToast(
          `${res.sectionConflicts.length} row(s) were left alone because the item is already in the ${isSpares ? 'Machinery' : 'Spares'} section.`,
          'error'
        );
      }
      refreshProducts();
      onImportComplete();
      onClose();
    } catch (err: any) {
      showToast(`Import failed: ${err.message || 'Database transaction error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isMachinery ? 'Import Machinery (CSV)' : isSpares ? 'Import Spare Parts (CSV)' : 'Import Products to SQL Master (CSV)'}
              </h2>
              <p className="text-xs text-slate-500">
                {isMachinery
                  ? 'Everything in this file is added to the Machinery section'
                  : isSpares
                  ? 'Everything in this file is added to the Spares section'
                  : 'Bulk upload equipment, tractor implements, and spare parts with database verification'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Workflow Breadcrumb Indicator */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <span className={step === 'upload' ? 'text-indigo-600 font-bold dark:text-indigo-400' : 'text-slate-400'}>
              1. Upload CSV
            </span>
            <ArrowRight className="h-3 w-3 text-slate-300" />
            <span className={step === 'preview' ? 'text-indigo-600 font-bold dark:text-indigo-400' : 'text-slate-400'}>
              2. Validate & Preview ({validatedRows.length} rows)
            </span>
            <ArrowRight className="h-3 w-3 text-slate-300" />
            <span className={step === 'importing' ? 'text-indigo-600 font-bold dark:text-indigo-400' : 'text-slate-400'}>
              3. SQL Transaction
            </span>
          </div>

          <button
            type="button"
            onClick={handleDownloadSample}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Sample CSV Template</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'upload' && (
            <div className="space-y-3">
              <div className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center hover:border-indigo-500 transition-colors dark:border-slate-700">
                <Upload className="mx-auto h-10 w-10 text-slate-400 mb-2" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Select CSV File to Import Products
                </h3>
                <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                  Upload file containing: Item Number (SKU), Product Name, Category, HSN, Unit, Rates, and Bin tracking.
                </p>

                <label className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 cursor-pointer">
                  <span>Browse CSV File</span>
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              {/* Supported Columns Guide */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-2">
                  Standard Recognized Column Headers
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">Item Number *</span>
                    <span className="block text-[10px] text-slate-400">e.g. PT-00125, SPR-BLD</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">Product Name *</span>
                    <span className="block text-[10px] text-slate-400">Equipment or spare name</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Category</span>
                    <span className="block text-[10px] text-slate-400">Tractor Implements, Blades</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">HSN Number</span>
                    <span className="block text-[10px] text-slate-400">8432</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">Selling Price *</span>
                    <span className="block text-[10px] text-slate-400">Retail / selling rate</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Purchase Price</span>
                    <span className="block text-[10px] text-slate-400">Cost / procurement</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">GST %</span>
                    <span className="block text-[10px] text-slate-400">0, 5, 12, 18, 28</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Rack Location</span>
                    <span className="block text-[10px] text-slate-400">Rack RACK-01 / Bin B-101</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              {/* Validation Summary Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Total Rows</span>
                  <div className="mt-0.5 text-lg font-extrabold text-slate-900 dark:text-white font-mono">
                    {validatedRows.length}
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                  <span className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                    Valid for Import
                  </span>
                  <div className="mt-0.5 text-lg font-extrabold text-emerald-700 dark:text-emerald-300 font-mono">
                    {validCount}
                  </div>
                </div>

                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
                  <span className="text-[10px] font-bold uppercase text-rose-700 dark:text-rose-400">
                    Invalid / Errors
                  </span>
                  <div className="mt-0.5 text-lg font-extrabold text-rose-700 dark:text-rose-300 font-mono">
                    {invalidCount}
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <span className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">
                    Existing in Database
                  </span>
                  <div className="mt-0.5 text-lg font-extrabold text-amber-700 dark:text-amber-300 font-mono">
                    {dbDuplicateCount}
                  </div>
                </div>
              </div>

              {/* Duplicate Resolution Strategy */}
              {dbDuplicateCount > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-xs dark:border-amber-900/70 dark:bg-amber-950/30">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <div>
                      <span className="font-bold text-amber-900 dark:text-amber-200">
                        {dbDuplicateCount} products already exist in SQL Database.
                      </span>
                      <span className="block text-[11px] text-amber-800/80 dark:text-amber-300/80">
                        Select how to handle duplicate Item Numbers:
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDuplicateStrategy('skip')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        duplicateStrategy === 'skip'
                          ? 'bg-amber-700 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Skip Duplicates
                    </button>
                    <button
                      type="button"
                      onClick={() => setDuplicateStrategy('update')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        duplicateStrategy === 'update'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Update / Replace Existing
                    </button>
                  </div>
                </div>
              )}

              {/* Preview Table */}
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Item Number (SKU)</th>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3 text-right">Cost</th>
                      <th className="py-2.5 px-3 text-right">Selling Rate</th>
                      <th className="py-2.5 px-3">Validation Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                    {validatedRows.map((r) => (
                      <tr
                        key={r.rowNumber}
                        className={
                          !r.isValid
                            ? 'bg-rose-50/40 dark:bg-rose-950/20'
                            : r.isDuplicateInDb
                            ? 'bg-amber-50/40 dark:bg-amber-950/20'
                            : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                        }
                      >
                        <td className="py-2 px-3 font-mono text-slate-400">#{r.rowNumber}</td>
                        <td className="py-2 px-3">
                          {r.isValid ? (
                            r.isDuplicateInDb ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px]">
                                Already in DB
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px]">
                                <CheckCircle2 className="h-2.5 w-2.5" /> Valid
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300 text-[10px]">
                              <AlertCircle className="h-2.5 w-2.5" /> Error
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-white">
                          {r.data.sku || '—'}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200 truncate max-w-xs">
                          {r.data.name || '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-500">{r.data.category}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                          ₹{r.data.purchasePrice}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                          ₹{r.data.sellingPrice}
                        </td>
                        <td className="py-2 px-3 text-rose-600 dark:text-rose-400 font-medium">
                          {r.errors.length > 0 ? r.errors.join('; ') : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            {step === 'preview' && (
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                ← Choose Another File
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>

            {step === 'preview' && (
              <button
                type="button"
                disabled={validCount === 0 || isSubmitting}
                onClick={handleConfirmImport}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Importing into SQL...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Confirm & Import ({validCount} Valid Products)</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
