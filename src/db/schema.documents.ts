import { boolean, doublePrecision, index, integer, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

// GST tax invoices, plain (no GST) invoices and quotations, issued by one of the companies in company_profiles.
// docType: invoice | quotation
// companyId: main | second. invoiceKind: tax | plain (plain = no GST; a quotation can be either).
// Numbers look like MAIN/0014/26-27 (tax invoice), MAIN-B/0003/26-27 (plain invoice) and MAIN-Q/0001/26-27 (quotation);
// the prefix comes from the company and each company/kind pair has its own sequence per financial year.
// invoice status: Draft | Issued | Partially Paid | Paid | Cancelled
// quotation status: Draft | Sent | Accepted | Rejected | Converted | Cancelled (Expired is derived from validUntil)
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    docType: text('doc_type').notNull(),
    docNumber: text('doc_number').notNull().unique(),
    companyId: text('company_id').default('main').notNull(),
    // 'plain' = no GST (invoice only, or a quotation without GST)
    invoiceKind: text('invoice_kind').default('tax').notNull(),
    branchId: text('branch_id').notNull(),
    status: text('status').default('Draft').notNull(),
    customerId: text('customer_id'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    customerGstin: text('customer_gstin'),
    billingAddress: text('billing_address'),
    shippingAddress: text('shipping_address'),
    placeOfSupply: text('place_of_supply').default('Tamil Nadu').notNull(),
    isInterState: boolean('is_inter_state').default(false).notNull(),
    docDate: text('doc_date').notNull(), // YYYY-MM-DD
    dueDate: text('due_date'), // invoices
    validUntil: text('valid_until'), // quotations
    subtotal: doublePrecision('subtotal').default(0).notNull(),
    totalDiscount: doublePrecision('total_discount').default(0).notNull(),
    taxableAmount: doublePrecision('taxable_amount').default(0).notNull(),
    cgst: doublePrecision('cgst').default(0).notNull(),
    sgst: doublePrecision('sgst').default(0).notNull(),
    igst: doublePrecision('igst').default(0).notNull(),
    otherCharges: doublePrecision('other_charges').default(0).notNull(),
    roundOff: doublePrecision('round_off').default(0).notNull(),
    grandTotal: doublePrecision('grand_total').default(0).notNull(),
    paidAmount: doublePrecision('paid_amount').default(0).notNull(),
    notes: text('notes'),
    terms: text('terms'),
    sourceQuotationId: text('source_quotation_id'),
    // set when this invoice was generated from a delivered machine sale
    sourceMachineSaleId: text('source_machine_sale_id'),
    // A machine sale's invoice that was edited by hand: it stops being rebuilt from the machine sale.
    manualEdit: boolean('manual_edit').default(false).notNull(),
    convertedInvoiceId: text('converted_invoice_id'),
    stockDeducted: boolean('stock_deducted').default(false).notNull(),
    // an old bill entered from the bill files: already settled, so it is never money still to collect
    isHistorical: boolean('is_historical').default(false).notNull(),
    // true when the entered line rates already include GST
    pricesIncludeTax: boolean('prices_include_tax').default(false).notNull(),
    buyerStateName: text('buyer_state_name'),
    buyerStateCode: text('buyer_state_code'),
    // Ship-to party; null fields mean "same as buyer".
    consigneeName: text('consignee_name'),
    consigneeAddress: text('consignee_address'),
    consigneeGstin: text('consignee_gstin'),
    consigneeStateName: text('consignee_state_name'),
    consigneeStateCode: text('consignee_state_code'),
    // e-Invoice and e-Way Bill values are typed in from the GST portal, Tally or a GSP.
    irn: text('irn'),
    ackNo: text('ack_no'),
    ackDate: text('ack_date'), // YYYY-MM-DD
    einvoiceQr: text('einvoice_qr'), // signed QR text
    ewayBillNo: text('eway_bill_no'),
    deliveryNote: text('delivery_note'),
    deliveryNoteDate: text('delivery_note_date'),
    referenceNo: text('reference_no'),
    referenceDate: text('reference_date'),
    buyerOrderNo: text('buyer_order_no'),
    buyerOrderDate: text('buyer_order_date'),
    dispatchDocNo: text('dispatch_doc_no'),
    dispatchedThrough: text('dispatched_through'),
    destination: text('destination'),
    ladingNo: text('lading_no'),
    ladingDate: text('lading_date'),
    vehicleNo: text('vehicle_no'),
    termsOfDelivery: text('terms_of_delivery'),
    paymentTerms: text('payment_terms'),
    otherReferences: text('other_references'),
    ewbMode: text('ewb_mode').default('1 - Road'),
    ewbGeneratedAt: text('ewb_generated_at'), // YYYY-MM-DDTHH:mm
    ewbValidUpto: text('ewb_valid_upto'), // YYYY-MM-DDTHH:mm
    ewbDistanceKm: integer('ewb_distance_km'),
    ewbSupplyType: text('ewb_supply_type').default('Outward-Supply'),
    ewbTransactionType: text('ewb_transaction_type').default('Regular'),
    transporterId: text('transporter_id'),
    transporterName: text('transporter_name'),
    transporterDocNo: text('transporter_doc_no'),
    transporterDocDate: text('transporter_doc_date'),
    ewbFromPlace: text('ewb_from_place'),
    // Random key for the public bill link sent to the customer.
    shareToken: text('share_token').unique(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull()
  },
  (t) => [
    index('idx_documents_branch').on(t.branchId),
    index('idx_documents_company').on(t.companyId),
    index('idx_documents_type_status').on(t.docType, t.status),
    index('idx_documents_date').on(t.docDate),
    index('idx_documents_customer_phone').on(t.customerPhone)
  ]
);

export const documentItems = pgTable(
  'document_items',
  {
    id: serial('id').primaryKey(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    productId: text('product_id'),
    // Warehouse the stock was taken from, kept so a cancellation can put it back.
    warehouseId: text('warehouse_id'),
    description: text('description').notNull(),
    batchNote: text('batch_note'), // batch / serial / engine number shown under the product
    sku: text('sku'),
    hsnCode: text('hsn_code'),
    unit: text('unit'),
    quantity: doublePrecision('quantity').notNull(),
    rate: doublePrecision('rate').notNull(),
    discountPercent: doublePrecision('discount_percent').default(0).notNull(),
    gstRate: integer('gst_rate').default(18).notNull(),
    taxableValue: doublePrecision('taxable_value').default(0).notNull(),
    taxAmount: doublePrecision('tax_amount').default(0).notNull(),
    lineTotal: doublePrecision('line_total').default(0).notNull(),
    sortOrder: integer('sort_order').default(0).notNull()
  },
  (t) => [index('idx_document_items_doc').on(t.documentId)]
);

// method: Cash | UPI | Bank Transfer | Card | Cheque
export const documentPayments = pgTable(
  'document_payments',
  {
    id: serial('id').primaryKey(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    amount: doublePrecision('amount').notNull(),
    method: text('method').default('Cash').notNull(),
    paidOn: text('paid_on').notNull(), // YYYY-MM-DD
    reference: text('reference'),
    receivedBy: text('received_by'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  (t) => [index('idx_document_payments_doc').on(t.documentId)]
);

// Gapless per-type, per-financial-year number sequence (fy like "2025-26").
export const documentCounters = pgTable(
  'document_counters',
  {
    docType: text('doc_type').notNull(),
    fy: text('fy').notNull(),
    last: integer('last').default(0).notNull()
  },
  (t) => [primaryKey({ columns: [t.docType, t.fy] })]
);
