/**
 * Sales document arithmetic shared by the API and the invoice screen, so the preview and the posted
 * figures can never differ. Money is handled in paise (integers) and returned in rupees.
 */

export interface SalesLineInput {
  quantity: number;
  rate: number;
  discountPct: number;
  gstRate: number;
}

export interface SalesTotals {
  lines: { amount: number; tax: number }[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

const paise = (rupees: number) => Math.round(rupees * 100);
const rupees = (p: number) => p / 100;

/**
 * Line amounts are quantity x rate less discount. Within the seller's state tax is split equally into CGST
 * and SGST; to another state it is all IGST.
 */
export function computeSalesTotals(lines: SalesLineInput[], intraState: boolean): SalesTotals {
  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  const out = lines.map((l) => {
    const amount = Math.round(l.quantity * paise(l.rate) * (1 - l.discountPct / 100));
    subtotal += amount;
    let tax: number;
    if (intraState) {
      const half = Math.round((amount * l.gstRate) / 200);
      cgst += half;
      sgst += half;
      tax = half * 2;
    } else {
      tax = Math.round((amount * l.gstRate) / 100);
      igst += tax;
    }
    return { amount: rupees(amount), tax: rupees(tax) };
  });
  return {
    lines: out,
    subtotal: rupees(subtotal),
    cgst: rupees(cgst),
    sgst: rupees(sgst),
    igst: rupees(igst),
    total: rupees(subtotal + cgst + sgst + igst),
  };
}

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : '', r ? below100(r) : ''].filter(Boolean).join(' ');
}

function words(n: number): string {
  if (n === 0) return 'zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${words(crore)} crore` : '',
    lakh ? `${below100(lakh)} lakh` : '',
    thousand ? `${below100(thousand)} thousand` : '',
    rest ? below1000(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** "One lakh ninety-four thousand seven hundred rupees only." in the Indian system. */
export function amountInWords(amount: number): string {
  const total = paise(amount);
  const r = Math.floor(total / 100);
  const p = total % 100;
  const text = `${words(r)} rupees${p ? ` and ${below100(p)} paise` : ''} only.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** GST state code from a GSTIN (its first two digits), or null. */
export function stateOfGstin(gstin: string | null | undefined): string | null {
  const m = /^(\d{2})[0-9A-Z]{13}$/.exec((gstin ?? '').trim().toUpperCase());
  return m ? m[1]! : null;
}
