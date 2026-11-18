import { db } from './index.ts';
import {
  branches,
  categories,
  customers,
  invoices,
  products,
  salesOrderItems,
  salesOrders,
  suppliers,
  warehouseStocks,
  warehouses,
  warranties
} from './schema.ts';
import {
  initialBranches,
  initialCustomers,
  initialInvoices,
  initialProducts,
  initialSalesOrders,
  initialSuppliers,
  initialWarehouses,
  initialWarranties
} from '../data/mockData.ts';

export async function seedDatabaseIfEmpty() {
  try {
    const existingProducts = await db.select().from(products).limit(1);
    if (existingProducts.length > 0) {
      console.log('Database already contains products. Skipping initial seed.');
      return { seeded: false, reason: 'Database already populated' };
    }

    console.log('Seeding initial Acme Agro Equipment ERP data into Cloud SQL...');

    // 1. Seed Branches
    for (const b of initialBranches) {
      await db
        .insert(branches)
        .values({
          id: b.id,
          code: b.code,
          name: b.name,
          city: b.city,
          state: b.state,
          address: b.address,
          phone: b.phone,
          gstin: b.gstin,
          manager: b.manager,
          isHeadOffice: b.code === 'BR-PMV-01' || b.id === 'branch-1'
        })
        .onConflictDoNothing();
    }

    // 2. Seed Warehouses
    for (const w of initialWarehouses) {
      await db
        .insert(warehouses)
        .values({
          id: w.id,
          code: w.code,
          name: w.name,
          branchId: w.branchId,
          type: 'Warehouse',
          capacity: String(w.capacitySqFt),
          address: w.location,
          manager: w.supervisor,
          phone: w.phone
        })
        .onConflictDoNothing();
    }

    // 3. Seed Categories
    const categoryNames = Array.from(new Set(initialProducts.map((p) => p.category)));
    for (const cat of categoryNames) {
      const code = cat.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const isSpare =
        cat.includes('Blades') ||
        cat.includes('PTO') ||
        cat.includes('Gearbox') ||
        cat.includes('Hydraulics') ||
        cat.includes('Spares') ||
        cat.includes('Bearings');

      await db
        .insert(categories)
        .values({
          code,
          name: cat,
          isSpareCategory: isSpare,
          description: `${cat} category for agro machinery and implements`
        })
        .onConflictDoNothing();
    }

    // 4. Seed Products
    for (const p of initialProducts) {
      await db
        .insert(products)
        .values({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          subcategory: p.subcategory || (p.isSparePart ? 'Agro Machinery Spares' : 'Machinery'),
          brand: p.brand || 'Acme Genuine Spares',
          barcode: p.barcode || `89060${Math.floor(1000000 + Math.random() * 9000000)}`,
          hsnCode: p.hsnCode || '8432',
          gstRate: p.gstRate || 18,
          unit: p.unit || 'Nos',
          purchasePrice: p.purchasePrice,
          sellingPrice: p.sellingPrice,
          mrp: p.mrp || Math.round(p.sellingPrice * 1.1),
          minStock: p.minStock ?? 10,
          maxStock: p.maxStock ?? 100,
          reorderLevel: p.reorderLevel ?? 15,
          description: p.description,
          imageUrl: p.imageUrl,
          status: p.status || 'In Stock',
          isArchived: p.isArchived ?? false,
          isSparePart: p.isSparePart ?? p.sku.startsWith('SPR-'),
          compatibleModels: p.compatibleModels?.join(', ') || undefined,
          oemPartNumber: p.oemPartNumber,
          shelfBinLocation: p.shelfBinLocation
        })
        .onConflictDoNothing();

      // Seed warehouse stocks for product
      if (p.warehouseStocks && p.warehouseStocks.length > 0) {
        for (const ws of p.warehouseStocks) {
          if (!initialWarehouses.some(w => w.id === ws.warehouseId)) continue;
          await db.insert(warehouseStocks).values({
            productId: p.id,
            warehouseId: ws.warehouseId,
            rack: ws.rack,
            row: ws.row,
            shelf: ws.shelf,
            bin: ws.bin,
            available: ws.available || 0,
            reserved: ws.reserved || 0,
            inTransit: ws.inTransit || 0
          });
        }
      } else {
        await db.insert(warehouseStocks).values({
          productId: p.id,
          warehouseId: 'wh-1',
          rack: 'RACK-01',
          row: '01',
          shelf: 'S-A',
          bin: 'B-101',
          available: (p as any).currentStock || 50,
          reserved: 0,
          inTransit: 0
        });
      }
    }

    // 5. Seed Customers
    for (const c of initialCustomers) {
      await db
        .insert(customers)
        .values({
          id: c.id,
          customerId: `CUST-${c.id.replace('cust-', '').padStart(3, '0')}`,
          companyName: c.companyName,
          name: c.name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          city: c.city,
          state: c.state || 'Tamil Nadu',
          gstin: c.gstin,
          creditLimit: c.creditLimit,
          creditPeriodDays: c.creditPeriodDays,
          outstandingBalance: c.outstandingBalance,
          rating: c.rating,
          lastTransactionDate: c.lastTransactionDate
        })
        .onConflictDoNothing();
    }

    // 6. Seed Suppliers
    for (const s of initialSuppliers) {
      await db
        .insert(suppliers)
        .values({
          id: s.id,
          companyName: s.companyName,
          name: s.name,
          phone: s.phone,
          email: s.email,
          address: s.address,
          city: s.city,
          gstin: s.gstin,
          materialsSupplied: (s as any).materialsSupplied ? (s as any).materialsSupplied.join(', ') : '',
          rating: 'A',
          outstandingPayable: s.outstandingPayable
        })
        .onConflictDoNothing();
    }

    // 7. Seed Warranties
    for (const w of initialWarranties) {
      await db
        .insert(warranties)
        .values({
          id: w.id,
          serialNumber: w.serialNumber,
          productId: w.productId,
          productName: w.productName,
          engineNumber: w.engineNumber,
          chassisNumber: w.chassisNumber,
          customerId: w.customerId,
          customerName: w.customerName,
          purchaseDate: w.purchaseDate,
          warrantyExpiryDate: w.warrantyEndDate,
          status: w.status,
          serviceRecords: JSON.stringify(w.serviceRecords || [])
        })
        .onConflictDoNothing();
    }

    // 8. Seed Sales Orders & Line Items
    for (const so of initialSalesOrders) {
      await db
        .insert(salesOrders)
        .values({
          id: so.id,
          orderNumber: so.orderNumber,
          customerId: so.customerId,
          customerName: so.customerName,
          branchId: so.branchId,
          warehouseId: so.warehouseId,
          salesperson: so.salesperson,
          orderDate: so.orderDate,
          expectedDeliveryDate: so.expectedDeliveryDate,
          subtotal: so.subtotal,
          totalDiscount: so.totalDiscount,
          taxAmount: so.taxAmount,
          grandTotal: so.grandTotal,
          paidAmount: so.paidAmount,
          balanceAmount: so.balanceAmount,
          paymentStatus: so.paymentStatus,
          status: so.status,
          shippingAddress: so.shippingAddress,
          notes: so.notes
        })
        .onConflictDoNothing();

      if (so.items && so.items.length > 0) {
        for (const it of so.items) {
          await db.insert(salesOrderItems).values({
            salesOrderId: so.id,
            productId: it.productId,
            productName: it.productName,
            sku: it.sku,
            unit: it.unit,
            quantity: it.quantity,
            rate: it.rate,
            discountPercent: it.discountPercent,
            taxRate: it.taxRate,
            taxAmount: it.taxAmount,
            totalAmount: it.totalAmount,
            hsnCode: it.hsnCode
          });
        }
      }
    }

    // 9. Seed Invoices
    for (const inv of initialInvoices) {
      await db
        .insert(invoices)
        .values({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          salesOrderId: inv.salesOrderId,
          customerId: inv.customerId,
          customerName: inv.customerName,
          branchId: inv.branchId,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          subtotal: inv.subtotal,
          totalDiscount: inv.totalDiscount,
          cgst: inv.cgstAmount || 0,
          sgst: inv.sgstAmount || 0,
          igst: inv.igstAmount || 0,
          grandTotal: inv.grandTotal,
          paidAmount: inv.paidAmount,
          balanceAmount: inv.balanceAmount,
          paymentStatus: inv.paymentStatus,
          status: inv.status,
          irn: (inv as any).irn || null,
          eWayBillNumber: (inv as any).eWayBillNumber || null
        })
        .onConflictDoNothing();
    }

    console.log('Cloud SQL initial database seeding complete!');
    return { seeded: true, count: initialProducts.length };
  } catch (error) {
    console.error('Error during initial database seeding:', error);
    throw new Error('Database seeding failed.', { cause: error });
  }
}
