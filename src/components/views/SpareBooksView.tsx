import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  FileText,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Download,
  Filter,
  Layers,
  Wrench,
  CheckCircle2,
  ExternalLink,
  Upload,
  Eye,
  X,
  FileSpreadsheet,
  Package,
  ArrowRight,
  Sparkles,
  Building2,
  RotateCw
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { SpareBook, SpareBookPage, SpareBookIndexItem } from '../../types/erp';

export const SpareBooksView: React.FC = () => {
  const {
    products,
    currentRole,
    setCurrentView,
    showToast
  } = useERP();

  const isOwner = currentRole === 'Business Owner' || currentRole === 'Super Admin';

  // Spare books state
  const [books, setBooks] = useState<SpareBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<SpareBook | null>(null);
  const [activePageNum, setActivePageNum] = useState<number>(14); // start on an interesting page
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Search state
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');
  const [inPageSearchQuery, setInPageSearchQuery] = useState<string>('');

  // Add / Upload Spare Book Modal state
  const [isAddBookModalOpen, setIsAddBookModalOpen] = useState<boolean>(false);
  const [newBookTitle, setNewBookTitle] = useState<string>('');
  const [newBookEquipment, setNewBookEquipment] = useState<SpareBook['equipmentType']>('Rotavator');
  const [newBookModel, setNewBookModel] = useState<string>('');
  const [newBookTotalPages, setNewBookTotalPages] = useState<number>(30);
  const [selectedFileName, setSelectedFileName] = useState<string>('');

  // Current active page data
  const currentPageData: SpareBookPage | undefined = useMemo(() => {
    if (!selectedBook) return undefined;
    return selectedBook.pages.find((p) => p.pageNumber === activePageNum) || {
      pageNumber: activePageNum,
      title: `Page ${activePageNum}`,
      section: 'Catalogue Section',
      rawOcrText: `Scanned catalogue page ${activePageNum} for ${selectedBook.title}. High precision blueprint and spare parts listing.`,
      items: []
    };
  }, [selectedBook, activePageNum]);

  // Global search across all books
  const globalSearchResults = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return [];

    const results: {
      book: SpareBook;
      page: SpareBookPage;
      item?: SpareBookIndexItem;
      snippet: string;
    }[] = [];

    books.forEach((book) => {
      book.pages.forEach((page) => {
        // Match items
        page.items.forEach((item) => {
          if (
            item.productName.toLowerCase().includes(q) ||
            item.itemNumber.toLowerCase().includes(q) ||
            (item.oemNumber && item.oemNumber.toLowerCase().includes(q)) ||
            item.hsnCode.toLowerCase().includes(q) ||
            (item.description && item.description.toLowerCase().includes(q))
          ) {
            results.push({
              book,
              page,
              item,
              snippet: `${item.productName} • Part #${item.itemNumber} (OEM: ${item.oemNumber || 'N/A'}) - HSN ${item.hsnCode}`
            });
          }
        });

        // Also match raw OCR text
        if (
          page.rawOcrText.toLowerCase().includes(q) &&
          !page.items.some((i) => i.productName.toLowerCase().includes(q))
        ) {
          results.push({
            book,
            page,
            snippet: `Found in scanned page OCR text: "...${page.rawOcrText.slice(0, 120)}..."`
          });
        }
      });
    });

    return results;
  }, [books, globalSearchQuery]);

  // Filtered books list
  const filteredBooks = useMemo(() => {
    return books.filter((b) => {
      if (categoryFilter !== 'all' && b.equipmentType !== categoryFilter) return false;
      return true;
    });
  }, [books, categoryFilter]);

  // Handle jump to specific page from search
  const handleJumpToPage = (book: SpareBook, pageNumber: number) => {
    setSelectedBook(book);
    setActivePageNum(pageNumber);
    showToast('Spare Book Opened', `Navigated to ${book.title} (Page ${pageNumber})`, 'info');
  };

  // Handle Zoom
  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 25, 200));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 25, 50));
  const handleZoomReset = () => setZoomLevel(100);

  // Handle Add Book
  const handleCreateBook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBookTitle.trim()) {
      showToast('Validation Error', 'Book title is required.', 'error');
      return;
    }

    const newBook: SpareBook = {
      id: `sb-${Date.now()}`,
      title: newBookTitle.trim(),
      equipmentType: newBookEquipment,
      modelSeries: newBookModel.trim() || 'Custom Equipment Series',
      totalPages: Number(newBookTotalPages) || 40,
      fileName: selectedFileName || `${newBookTitle.replace(/\s+/g, '_')}_Spare_Manual.pdf`,
      fileSizeKb: Math.floor(2500 + Math.random() * 4000),
      isOcrProcessed: true,
      indexedItemsCount: 15,
      uploadDate: new Date().toISOString().split('T')[0],
      version: 'v1.0',
      pages: [
        {
          pageNumber: 1,
          title: 'Cover & Exploded General Assembly',
          section: 'Introduction',
          diagramTitle: 'General Exploded View',
          rawOcrText: `SPARE MANUAL - ${newBookTitle.toUpperCase()}. OCR text extracted and searchable.`,
          items: []
        },
        {
          pageNumber: 5,
          title: 'Main Drive & Working Spares',
          section: 'Drive Unit',
          diagramTitle: 'Working Components Exploded Drawing',
          rawOcrText: `Exploded spare components for ${newBookTitle}. Boron steel blades, shafts, gear drive and hardware fasteners.`,
          items: [
            {
              id: `sbi-new-1`,
              bookId: `sb-${Date.now()}`,
              pageNumber: 5,
              productName: `${newBookTitle} Genuine Working Spares`,
              itemNumber: `SPR-GEN-${Math.floor(100 + Math.random() * 900)}`,
              oemNumber: `OEM-GEN-990`,
              hsnCode: '8432',
              description: 'Factory original equipment replacement spare part',
              sellingPrice: 1200,
              availableStock: 25
            }
          ]
        }
      ]
    };

    setBooks([newBook, ...books]);
    setSelectedBook(newBook);
    setActivePageNum(1);
    setIsAddBookModalOpen(false);
    setNewBookTitle('');
    setNewBookModel('');
    showToast('Spare Book Added', `Added "${newBook.title}" with OCR text extraction & search indexing.`, 'success');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      
      {/* Top Header Bar */}
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                Spare Books & PDF Catalogues
              </h1>
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
                OCR Indexed & Searchable
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Interactive spare parts catalogues for Rotavator, Baler, Power Tiller & Hydraulics with instant page navigation and inventory cross-linking.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Owner can add new spare books */}
          {isOwner && (
            <button
              onClick={() => setIsAddBookModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 active:scale-98 cursor-pointer transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Add Spare Book</span>
            </button>
          )}
        </div>
      </div>

      {/* Global Search Banner */}
      <div className="border-b border-slate-200 bg-slate-100/70 px-6 py-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="relative max-w-2xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={globalSearchQuery}
            onChange={(e) => setGlobalSearchQuery(e.target.value)}
            placeholder="Search all Spare Books by Product Name, Item Number (PT-00125), OEM No, or HSN (8432)..."
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          {globalSearchQuery && (
            <button
              onClick={() => setGlobalSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Global Search Results Popup Dropdown */}
        {globalSearchQuery.trim().length > 0 && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-indigo-200 bg-white p-3 shadow-xl dark:border-indigo-900/80 dark:bg-slate-900 z-30 relative">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                <Sparkles className="h-3.5 w-3.5" />
                Found {globalSearchResults.length} matches across Spare Books
              </span>
              <span className="text-[11px] text-slate-400">Click any result to jump to page</span>
            </div>

            {globalSearchResults.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No matching spare parts or OCR text found for "{globalSearchQuery}".
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 pt-1">
                {globalSearchResults.map((res, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      handleJumpToPage(res.book, res.page.pageNumber);
                      setGlobalSearchQuery('');
                    }}
                    className="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {res.item ? res.item.productName : res.page.title}
                        </span>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                          {res.book.equipmentType} • Page {res.page.pageNumber}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{res.snippet}</p>
                    </div>

                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-indigo-500"
                    >
                      <span>OPEN PAGE {res.page.pageNumber}</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar: Spare Books Library */}
        <div className="w-80 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Spare Books Library ({books.length})
            </span>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <option value="all">All Equipment</option>
              <option value="Rotavator">Rotavator</option>
              <option value="Baler">Baler</option>
              <option value="Power Tiller">Power Tiller</option>
              <option value="Hydraulics">Hydraulics</option>
            </select>
          </div>

          {/* Book Cards List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {filteredBooks.map((b) => {
              const isSelected = selectedBook?.id === b.id;
              return (
                <div
                  key={b.id}
                  onClick={() => {
                    setSelectedBook(b);
                    setActivePageNum(b.pages[0]?.pageNumber || 1);
                  }}
                  className={`rounded-xl border p-3.5 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/50 shadow-xs dark:border-indigo-600 dark:bg-indigo-950/40'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {b.equipmentType}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">{b.version}</span>
                  </div>

                  <h3 className="mt-1.5 text-xs font-bold text-slate-900 dark:text-white line-clamp-2">
                    {b.title}
                  </h3>

                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{b.totalPages} Pages</span>
                    <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> {b.indexedItemsCount} Indexed Spares
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Main Area: Interactive PDF / Blueprint Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
          
          {selectedBook ? (
            <>
              {/* Viewer Control Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2.5 dark:border-slate-800 dark:bg-slate-900 shadow-2xs">
                
                {/* Page Navigation */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setActivePageNum((p) => Math.max(p - 1, 1))}
                    disabled={activePageNum <= 1}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                    title="Previous Page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-slate-500">Page</span>
                    <input
                      type="number"
                      min={1}
                      max={selectedBook.totalPages}
                      value={activePageNum}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 1 && val <= selectedBook.totalPages) {
                          setActivePageNum(val);
                        }
                      }}
                      className="w-14 rounded-md border border-slate-300 bg-slate-50 py-1 text-center font-mono font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <span className="text-slate-500">of {selectedBook.totalPages}</span>
                  </div>

                  <button
                    onClick={() => setActivePageNum((p) => Math.min(p + 1, selectedBook.totalPages))}
                    disabled={activePageNum >= selectedBook.totalPages}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                    title="Next Page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>

                  {/* Thumbnail jump buttons for pages that have items */}
                  <div className="hidden lg:flex items-center gap-1 pl-3 border-l border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] text-slate-400 font-semibold">Indexed Plates:</span>
                    {selectedBook.pages.map((p) => (
                      <button
                        key={p.pageNumber}
                        onClick={() => setActivePageNum(p.pageNumber)}
                        className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${
                          activePageNum === p.pageNumber
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        P.{p.pageNumber}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Zoom & View Controls */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleZoomOut}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                    {zoomLevel}%
                  </span>
                  <button
                    onClick={handleZoomIn}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                    title="Zoom In"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleZoomReset}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Fit Width
                  </button>
                </div>
              </div>

              {/* Viewer Workspace */}
              <div className="flex-1 overflow-auto p-6 flex flex-col items-center">
                
                {/* Simulated High-Res Scanned Document Page */}
                <div
                  style={{ width: `${Math.round((850 * zoomLevel) / 100)}px` }}
                  className="rounded-xl border border-slate-300 bg-white p-8 shadow-2xl transition-all duration-150 dark:border-slate-700 dark:bg-slate-900"
                >
                  
                  {/* Page Top Header */}
                  <div className="flex items-center justify-between border-b-2 border-indigo-600 pb-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                        {selectedBook.title}
                      </span>
                      <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                        {currentPageData?.title || `Catalogue Page ${activePageNum}`}
                      </h2>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-xs font-bold text-slate-500">
                        PLATE REF: 0{activePageNum}
                      </span>
                      <p className="text-[10px] text-slate-400">Section: {currentPageData?.section || 'General'}</p>
                    </div>
                  </div>

                  {/* Blueprint Diagram Schematic Box */}
                  <div className="my-6 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-6 dark:border-indigo-900/60 dark:bg-slate-950/60">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                        <Wrench className="h-4 w-4 text-indigo-600" />
                        {currentPageData?.diagramTitle || `Exploded Diagram - Page ${activePageNum}`}
                      </span>
                      <span className="rounded bg-indigo-200/80 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                        High Precision CAD Blueprint
                      </span>
                    </div>

                    {/* Schematic Visualization Graphic */}
                    <div className="relative h-64 rounded-lg bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4 text-white overflow-hidden flex flex-col justify-between">
                      {/* Engineering Grid Background */}
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-40 pointer-events-none" />

                      <div className="relative z-10 flex justify-between items-start">
                        <span className="font-mono text-[10px] text-indigo-400">
                          DRAWING NO: CAD-PS-{selectedBook.equipmentType.toUpperCase()}-{activePageNum}
                        </span>
                        <span className="font-mono text-[10px] text-emerald-400">
                          TOLERANCE: ±0.02mm DIN 7168
                        </span>
                      </div>

                      {/* Schematic Diagram Icons & Callouts */}
                      <div className="relative z-10 flex items-center justify-center gap-8 py-4">
                        {currentPageData?.items && currentPageData.items.length > 0 ? (
                          currentPageData.items.map((it, idx) => (
                            <div
                              key={it.id}
                              className="group relative flex flex-col items-center p-3 rounded-xl bg-slate-800/80 border border-indigo-500/50 backdrop-blur-xs hover:border-amber-400 hover:scale-105 transition-all cursor-pointer"
                            >
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/60 text-white font-bold text-xs mb-2">
                                #{idx + 1}
                              </div>
                              <span className="font-bold text-xs text-white max-w-xs text-center truncate">
                                {it.productName}
                              </span>
                              <span className="font-mono text-[10px] text-amber-300 mt-0.5">
                                Part: {it.itemNumber}
                              </span>
                              <span className="text-[10px] text-indigo-300">
                                OEM: {it.oemNumber || 'Standard'}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-center text-slate-400">
                            <Layers className="h-10 w-10 mx-auto text-slate-600 mb-2" />
                            <p className="text-xs font-semibold">General Assembly Structural Plate</p>
                            <p className="text-[10px] text-slate-500">
                              Refer to indexed part pages for itemized component breakdown.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="relative z-10 flex justify-between items-end text-[10px] text-slate-400">
                        <span>Acme Agro Engineering Works</span>
                        <span>SCALE 1:5 • ALL DIMENSIONS IN MM</span>
                      </div>
                    </div>
                  </div>

                  {/* OCR Extracted Text & Indexed Spares Table */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <FileText className="h-4 w-4 text-indigo-600" />
                        <span>Indexed Spare Parts on this Page ({currentPageData?.items?.length || 0})</span>
                      </h4>
                      <span className="text-[11px] text-slate-400">
                        Synchronized with Centralized Master Inventory
                      </span>
                    </div>

                    {currentPageData?.items && currentPageData.items.length > 0 ? (
                      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
                            <tr>
                              <th className="py-2.5 px-3">Callout #</th>
                              <th className="py-2.5 px-3">Spare Part Name</th>
                              <th className="py-2.5 px-3">Item # (SKU)</th>
                              <th className="py-2.5 px-3">OEM Part #</th>
                              <th className="py-2.5 px-3">HSN Code</th>
                              <th className="py-2.5 px-3 text-right">Master Price</th>
                              <th className="py-2.5 px-3 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {currentPageData.items.map((item, idx) => (
                              <tr key={item.id} className="hover:bg-indigo-50/40 dark:hover:bg-slate-800/60">
                                <td className="py-2 px-3 font-mono font-bold text-indigo-600">
                                  #{idx + 1}
                                </td>
                                <td className="py-2 px-3">
                                  <p className="font-bold text-slate-900 dark:text-white">
                                    {item.productName}
                                  </p>
                                  {item.description && (
                                    <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                                      {item.description}
                                    </p>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                                  {item.itemNumber}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-500">
                                  {item.oemNumber || '-'}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-500">
                                  {item.hsnCode}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                                  ₹{item.sellingPrice?.toLocaleString() || '-'}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  {/* Direct Link to Inventory */}
                                  <button
                                    onClick={() => {
                                      setCurrentView('inventory');
                                      showToast(
                                        'Inventory Cross-Reference',
                                        `Viewing inventory record for "${item.productName}" (Part: ${item.itemNumber})`,
                                        'info'
                                      );
                                    }}
                                    className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 cursor-pointer"
                                    title="View this product in Inventory & Spares"
                                  >
                                    <span>View Inventory</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
                        This page contains structural layout information. Refer to indexed plates for itemized part callouts.
                      </div>
                    )}

                    {/* Raw OCR Text Extraction Viewer */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        OCR Text Extracted from Scanned PDF Page
                      </span>
                      <p className="font-mono text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {currentPageData?.rawOcrText}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <BookOpen className="h-12 w-12 text-slate-400 mb-3" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                Select a Spare Book from the Library
              </h3>
              <p className="text-xs text-slate-500 max-w-md mt-1">
                Choose from Rotavator, Baler, Power Tiller or Hydraulics manuals to view exploded parts diagrams and look up part numbers.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Add / Upload New Spare Book (Owner Only) */}
      {isAddBookModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Add New Spare Book & Upload PDF
                </h3>
              </div>
              <button
                onClick={() => setIsAddBookModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateBook} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Catalogue Title *
                </label>
                <input
                  type="text"
                  required
                  value={newBookTitle}
                  onChange={(e) => setNewBookTitle(e.target.value)}
                  placeholder="e.g. Laser Land Leveller 7-ft Spare Catalogue"
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Equipment Type
                  </label>
                  <select
                    value={newBookEquipment}
                    onChange={(e) => setNewBookEquipment(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Rotavator">Rotavator</option>
                    <option value="Baler">Baler</option>
                    <option value="Power Tiller">Power Tiller</option>
                    <option value="Hydraulics">Hydraulics</option>
                    <option value="Tractor Implement">Tractor Implement</option>
                    <option value="Other Equipment">Other Equipment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Model / Series
                  </label>
                  <input
                    type="text"
                    value={newBookModel}
                    onChange={(e) => setNewBookModel(e.target.value)}
                    placeholder="e.g. LL-700 Series"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Total Pages
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newBookTotalPages}
                    onChange={(e) => setNewBookTotalPages(parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Upload PDF File
                  </label>
                  <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer">
                    <Upload className="h-4 w-4 text-indigo-600" />
                    <span className="truncate max-w-[140px]">{selectedFileName || 'Browse PDF...'}</span>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setSelectedFileName(file.name);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-lg bg-indigo-50/70 p-3 text-[11px] text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
                <span className="font-bold">OCR & Search Indexing:</span> Uploaded PDFs are automatically scanned, text is extracted into the database search index, and parts are cross-linked with inventory items.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddBookModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-500 cursor-pointer"
                >
                  Add & Index Catalogue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
