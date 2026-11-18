import React from 'react';
import { PredictiveAnalysis } from '../dashboard/PredictiveAnalysis';

// All the predictions in one place: the year ahead, rain and season, stock and orders, customers, machines and money, subsidies.
export const PredictionsView: React.FC = () => (
  <div className="space-y-4 pb-12">
    <div>
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Predictions</h1>
      <p className="text-xs text-slate-500 dark:text-slate-400">What to expect and what to get ready for, worked out from your own sales records.</p>
    </div>
    <PredictiveAnalysis />
  </div>
);
