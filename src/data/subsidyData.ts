// Government subsidy data for agricultural machinery, collected from official documents on 25 Oct 2026.
// Rules and rupee limits change with every budget and state order, so every figure carries its source and the screen says
// to confirm with the district Agricultural Engineering office before promising anything to a customer.

export const SUBSIDY_CHECKED_ON = '25 Oct 2026';

export interface SubsidySource {
  label: string;
  url: string;
}

export const SUBSIDY_SOURCES: Record<string, SubsidySource> = {
  smam: {
    label: 'SMAM Revised Operational Guidelines, 18 Dec 2025 (Annexure I: maximum subsidy per machine)',
    url: 'https://agriculture.hp.gov.in/wp-content/uploads/2026/02/SMAM-Revised-Operational-Guidelines-dated-18-12-2025.pdf'
  },
  smamPortal: { label: 'Farm machinery portal: register and apply', url: 'https://agrimachinery.nic.in/' },
  tnBudget: { label: 'TN Agriculture Budget 2026-27: mechanisation, Rs 227.20 crore (DT Next)', url: 'https://www.dtnext.in/news/tamilnadu/tn-agri-budget-2026-mechanisation-drive-to-get-rs-227-crore-fillip' },
  tnEarly: { label: 'TN early subsidy plan for power tillers and weeders, July 2023 (DT Next)', url: 'https://www.dtnext.in/news/tamilnadu/major-relief-to-farmers-as-tn-govt-introduces-early-subsidy-plan-to-purchase-agri-machineries' },
  tnApply: { label: 'How to apply for a tractor subsidy in Tamil Nadu, May 2026 (Eicher blog)', url: 'https://eichertractors.in/blog/?p=1631' },
  aif: { label: 'Agriculture Infrastructure Fund terms (Vikaspedia)', url: 'https://en.vikaspedia.in/schemesall/schemes-for-farmers/agriculture-infrastructure-fund' }
};

// Rupee limits are in lakhs, as printed in Annexure I. `priority` = SC/ST, small and marginal farmers, women (50%);
// `other` = every other farmer (40%).
export interface SubsidyMachine {
  id: string;
  group: 'Tractors' | 'Power tillers' | 'Rotavators' | 'Tillage and land preparation' | 'Harvesting';
  name: string;
  note?: string;
  priorityCapLakh: number;
  otherCapLakh: number;
}

export const SUBSIDY_MACHINES: SubsidyMachine[] = [
  // ---- tractors ----
  { id: 'tr-2wd-20', group: 'Tractors', name: 'Tractor 2WD, up to 20 PTO HP', priorityCapLakh: 2.0, otherCapLakh: 1.6 },
  { id: 'tr-4wd-20', group: 'Tractors', name: 'Tractor 4WD, up to 20 PTO HP', priorityCapLakh: 2.45, otherCapLakh: 1.96 },
  { id: 'tr-2wd-40', group: 'Tractors', name: 'Tractor 2WD, above 20 and up to 40 PTO HP', priorityCapLakh: 3.0, otherCapLakh: 2.4 },
  { id: 'tr-4wd-40', group: 'Tractors', name: 'Tractor 4WD, above 20 and up to 40 PTO HP', priorityCapLakh: 3.6, otherCapLakh: 2.88 },
  { id: 'tr-2wd-50', group: 'Tractors', name: 'Tractor 2WD, above 40 and up to 50 PTO HP', priorityCapLakh: 4.5, otherCapLakh: 3.6 },
  { id: 'tr-4wd-50', group: 'Tractors', name: 'Tractor 4WD, above 40 and up to 50 PTO HP', priorityCapLakh: 5.45, otherCapLakh: 4.36 },
  { id: 'tr-2wd-50p', group: 'Tractors', name: 'Tractor 2WD, above 50 PTO HP', priorityCapLakh: 6.0, otherCapLakh: 4.8 },
  { id: 'tr-4wd-50p', group: 'Tractors', name: 'Tractor 4WD, above 50 PTO HP', priorityCapLakh: 6.5, otherCapLakh: 5.2 },
  // ---- power tillers ----
  { id: 'pt-11', group: 'Power tillers', name: 'Power tiller, 8 BHP and up to 11 BHP', priorityCapLakh: 1.0, otherCapLakh: 0.8 },
  { id: 'pt-11p', group: 'Power tillers', name: 'Power tiller, above 11 BHP', priorityCapLakh: 1.2, otherCapLakh: 1.0 },
  // ---- rotavators (the limit depends on the width) ----
  { id: 'rv-4', group: 'Rotavators', name: 'Rotavator up to 4 ft (power tiller or tractor below 20 BHP)', priorityCapLakh: 0.45, otherCapLakh: 0.36 },
  { id: 'rv-5', group: 'Rotavators', name: 'Rotavator up to 5 ft (tractor 20 to 35 BHP)', priorityCapLakh: 0.46, otherCapLakh: 0.368 },
  { id: 'rv-6', group: 'Rotavators', name: 'Rotavator 6 ft', priorityCapLakh: 0.6, otherCapLakh: 0.48 },
  { id: 'rv-7', group: 'Rotavators', name: 'Rotavator 7 ft', priorityCapLakh: 0.7, otherCapLakh: 0.56 },
  { id: 'rv-8', group: 'Rotavators', name: 'Rotavator 8 ft', priorityCapLakh: 0.73, otherCapLakh: 0.584 },
  { id: 'rv-9', group: 'Rotavators', name: 'Rotavator 9 ft', note: 'The "other farmers" limit is printed as 0.578 in the guidelines; confirm it with the office', priorityCapLakh: 0.85, otherCapLakh: 0.578 },
  { id: 'rv-10', group: 'Rotavators', name: 'Rotavator 10 ft', priorityCapLakh: 0.95, otherCapLakh: 0.76 },
  // ---- other tillage and land preparation ----
  { id: 'rp-7', group: 'Tillage and land preparation', name: 'Roto-puddler 7 ft', priorityCapLakh: 0.8, otherCapLakh: 0.64 },
  { id: 'rp-10', group: 'Tillage and land preparation', name: 'Roto-puddler 10 ft', priorityCapLakh: 1.0, otherCapLakh: 0.8 },
  { id: 'rc', group: 'Tillage and land preparation', name: 'Rotocultivator (tractor above 35 BHP)', priorityCapLakh: 1.0, otherCapLakh: 0.8 },
  { id: 'ph', group: 'Tillage and land preparation', name: 'Power harrow (PTO operated)', priorityCapLakh: 1.35, otherCapLakh: 1.08 },
  { id: 'rdh', group: 'Tillage and land preparation', name: 'Rotary disc harrow (PTO powered)', priorityCapLakh: 0.75, otherCapLakh: 0.6 },
  { id: 'cult', group: 'Tillage and land preparation', name: 'Cultivator (tractor 20 to 35 BHP)', priorityCapLakh: 0.18, otherCapLakh: 0.144 },
  { id: 'disc', group: 'Tillage and land preparation', name: 'Disc plough (tractor 20 to 35 BHP)', priorityCapLakh: 0.25, otherCapLakh: 0.2 },
  { id: 'mb', group: 'Tillage and land preparation', name: 'MB plough, single bottom (tractor 20 to 35 BHP)', priorityCapLakh: 0.35, otherCapLakh: 0.28 },
  { id: 'harrow', group: 'Tillage and land preparation', name: 'Harrow (tractor 20 to 35 BHP)', priorityCapLakh: 0.28, otherCapLakh: 0.224 },
  { id: 'rhmb2', group: 'Tillage and land preparation', name: 'Reversible hydraulic MB plough, 2 bottom', priorityCapLakh: 0.71, otherCapLakh: 0.568 },
  { id: 'subsoil', group: 'Tillage and land preparation', name: 'Sub-soiler, two bottom', priorityCapLakh: 0.3, otherCapLakh: 0.24 },
  { id: 'laser', group: 'Tillage and land preparation', name: 'Laser land leveller', priorityCapLakh: 2.0, otherCapLakh: 1.6 },
  // ---- harvesting ----
  { id: 'ch-sp', group: 'Harvesting', name: 'Combine harvester, self-propelled', priorityCapLakh: 9.6, otherCapLakh: 7.68 },
  { id: 'ch-tr', group: 'Harvesting', name: 'Combine harvester, tractor powered (without tractor)', priorityCapLakh: 3.6, otherCapLakh: 2.88 }
];

export type FarmerCategory = 'priority' | 'other';

export function subsidyFor(machine: SubsidyMachine, price: number, category: FarmerCategory) {
  const rate = category === 'priority' ? 0.5 : 0.4;
  const cap = (category === 'priority' ? machine.priorityCapLakh : machine.otherCapLakh) * 100000;
  const byRate = Math.max(0, price) * rate;
  const subsidy = Math.round(Math.min(byRate, cap));
  return {
    rate,
    cap,
    subsidy,
    farmerPays: Math.max(0, Math.round(price - subsidy)),
    cappedByLimit: byRate > cap,
    // price at which the percentage stops mattering because the cap is reached
    capReachedAt: Math.round(cap / rate)
  };
}

// ---------- schemes, in plain words ----------
export interface SubsidyScheme {
  id: string;
  title: string;
  who: string;
  benefit: string;
  details: string[];
  source: keyof typeof SUBSIDY_SOURCES;
  asOf: string;
}

export const SUBSIDY_SCHEMES: SubsidyScheme[] = [
  {
    id: 'smam',
    title: 'Central scheme: Sub-Mission on Agricultural Mechanization (SMAM)',
    who: 'Individual farmers; run in Tamil Nadu by the Agricultural Engineering Department',
    benefit: '50% of the machine cost for SC/ST, small and marginal farmers and women; 40% for other farmers, up to a limit for each machine',
    details: [
      'The limit is a rupee amount set for each machine (see the calculator on this page). A tractor above 50 PTO HP 4WD is limited to Rs 6.5 lakh for the first group and Rs 5.2 lakh for the others.',
      'Custom Hiring Centres: 40% of the project cost for projects up to Rs 250 lakh.',
      'Village Farm Machinery Banks: 80% of the project cost up to Rs 30 lakh; larger projects are limited to Rs 24 lakh of assistance. Projects above Rs 10 lakh are credit linked with the subsidy paid after the loan.',
      'Register on the farm machinery portal; buy only machines on the approved list and only after approval.'
    ],
    source: 'smam',
    asOf: 'Guidelines dated 18 Dec 2025'
  },
  {
    id: 'tn-2026',
    title: 'Tamil Nadu Agricultural Mechanisation Scheme 2026-27',
    who: 'Farmers across Tamil Nadu, with priority to women farmers; 30% of the money is kept for women self-help groups',
    benefit: 'Rs 227.20 crore for about 24,000 farmers: 8,870 power tillers, 5,090 power weeders, 1,400 rotavators and 855 tractors',
    details: [
      '50 village-level Custom Hiring Centres at 80% subsidy, up to Rs 8 lakh each.',
      '50 integrated Machinery Hiring Business Centres (Rs 8.13 crore): 75% subsidy for SC/ST and women entrepreneurs and agricultural engineering graduates, 50% for others.',
      'The number of machines is limited, so early applications matter. The per-machine percentages follow the central scheme unless the state order says otherwise.'
    ],
    source: 'tnBudget',
    asOf: 'Budget 2026-27'
  },
  {
    id: 'tn-tiller',
    title: 'Tamil Nadu power tiller and power weeder subsidy (advance subsidy)',
    who: 'Individual farmers, with the highest rate for small and marginal, Adi Dravidar, tribal and women farmers',
    benefit: 'Power tiller up to Rs 85,000 (50%) or Rs 70,000 (40%); power weeder up to Rs 63,000 or Rs 50,000. SC/ST farmers get a further 20%',
    details: [
      'Under the advance plan the farmer pays only their own share to the dealer; the subsidy is paid by the government, so no bank loan is needed to fund the subsidy part.',
      'These amounts are from the July 2023 announcement. Check what applies this year.'
    ],
    source: 'tnEarly',
    asOf: 'July 2023 announcement'
  },
  {
    id: 'aif',
    title: 'Agriculture Infrastructure Fund (loan support for custom hiring and machinery services)',
    who: 'Farmers, FPOs, self-help groups, cooperatives, PACS, agri-entrepreneurs and start-ups. Custom hiring centres are an eligible project',
    benefit: '3% a year interest subvention on loans up to Rs 2 crore for up to 7 years; the credit guarantee fee is paid by the government',
    details: ['Promoter contribution is usually at least 10% of the project cost.', 'Runs from FY2020 to FY2032; terms are set by the lending bank, so confirm with the bank.'],
    source: 'aif',
    asOf: 'Scheme period FY2020 to FY2032'
  }
];

export const SUBSIDY_STEPS = [
  'The farmer registers in the Uzhavan app, or at the nearest Agricultural Engineering Department (AED) office or Common Service Centre.',
  'Documents: Aadhaar, land ownership proof, an Aadhaar-linked bank account, photographs and the filled application form (land details and the machine wanted).',
  'Officials check the application, and a field visit may follow. Approval has to come BEFORE the machine is bought.',
  'The machine is bought from an authorised dealer. The subsidy is paid to the farmer’s bank account (DBT), or under the advance plan the farmer pays only their share.',
  'Only one subsidy per farmer or family for the same kind of machine within the scheme period.'
];

export const SUBSIDY_DISCLAIMER =
  'Rates and limits change with each budget and government order. Use these figures to start a conversation, and confirm the current amount and whether the machine and dealer are approved with the district Agricultural Engineering office before promising a farmer anything.';
