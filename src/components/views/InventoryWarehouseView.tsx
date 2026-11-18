import React from 'react';
import { Boxes, Building2 } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { InventoryView } from './InventoryView';
import { WarehousesView } from './WarehousesView';

// One page for stock: the product list with spares, and where that stock sits by warehouse.
const TABS = [
  { id: 'inventory' as const, label: 'Inventory & Spares', icon: Boxes },
  { id: 'warehouses' as const, label: 'Warehouses', icon: Building2 }
];

export const InventoryWarehouseView: React.FC = () => {
  const { currentView, setCurrentView, currentRole } = useERP();
  const canSeeWarehouses = currentRole !== 'Salesperson' && currentRole !== 'Cashier';
  const active = currentView === 'warehouses' && canSeeWarehouses ? 'warehouses' : 'inventory';
  const tabs = canSeeWarehouses ? TABS : TABS.slice(0, 1);

  return (
    <div className="space-y-5">
      {tabs.length > 1 && (
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setCurrentView(t.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                  on
                    ? 'bg-slate-800 text-white dark:bg-slate-700'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {active === 'warehouses' ? <WarehousesView /> : <InventoryView />}
    </div>
  );
};
