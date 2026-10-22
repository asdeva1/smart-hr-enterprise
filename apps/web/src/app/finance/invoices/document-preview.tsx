import { cn } from '@/lib/utils';
import { inr } from '@/lib/finance';
import {
  DOC_TITLE,
  GST_STATES,
  type Seller,
  type SalesDocType,
  type SalesLine,
  type Template,
} from '@/lib/sales';

export interface PreviewDoc {
  type: SalesDocType;
  number: string | null;
  date: string;
  dueDate: string | null;
  poNumber: string | null;
  companyName: string;
  seller: Seller | null;
  customer: {
    name: string;
    gstin: string | null;
    billingAddress: string | null;
    stateCode: string | null;
  } | null;
  placeOfSupply: string | null;
  lines: (SalesLine & { amount: number })[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  amountInWords: string;
  note: string | null;
  terms: string | null;
}

type Style = Pick<
  Template,
  'layout' | 'accent' | 'showHsn' | 'showGstSplit' | 'showBank' | 'showUpi' | 'showSignatory' | 'showPo'
>;

const FALLBACK: Style = {
  layout: 'CLASSIC',
  accent: '#1d56c9',
  showHsn: true,
  showGstSplit: true,
  showBank: true,
  showUpi: true,
  showSignatory: false,
  showPo: true,
};

/** The document as the customer sees it. Printing the page prints only this block. */
export function DocumentPreview({ doc, template }: { doc: PreviewDoc; template: Style | null }) {
  const t = template ?? FALLBACK;
  const accent = t.accent;
  const modern = t.layout === 'MODERN';
  const minimal = t.layout === 'MINIMAL';
  const compact = t.layout === 'COMPACT_GST';
  const initials = doc.companyName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const taxed = doc.cgst + doc.sgst + doc.igst > 0;
  const pad = compact ? 'py-1' : 'py-2';
  const money = doc.type !== 'CHALLAN';
  return (
    <div
      className="print-area flex flex-col gap-5 rounded-lg border border-border bg-white p-7 text-[13px] text-[#14232d] shadow-sm"
      style={{ ['--accent' as string]: accent }}
    >
      <div
        className={cn(
          'flex flex-wrap justify-between gap-3',
          modern && '-mx-7 -mt-7 rounded-t-lg px-7 py-5 text-white',
        )}
        style={modern ? { background: accent } : undefined}
      >
        <div className="flex items-start gap-3">
          {!minimal && (
            <div
              className="flex size-11 items-center justify-center rounded-md text-base font-bold text-white"
              style={{ background: modern ? 'rgba(255,255,255,.25)' : accent }}
            >
              {initials}
            </div>
          )}
          <div>
            <div className="text-[15px] font-semibold">{doc.companyName}</div>
            {doc.seller?.gstin && <div className="text-xs opacity-80">GSTIN {doc.seller.gstin}</div>}
            {doc.seller?.address && (
              <div className="max-w-64 text-xs whitespace-pre-line opacity-80">{doc.seller.address}</div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-xl font-bold tracking-wide"
            style={modern ? undefined : { color: minimal ? undefined : accent }}
          >
            {DOC_TITLE[doc.type]}
          </div>
          <div className="text-xs opacity-80">{doc.number ?? 'Number given when issued'}</div>
          <div className="text-xs opacity-80">Date {doc.date}</div>
          {doc.dueDate && doc.type === 'INVOICE' && (
            <div className="text-xs opacity-80">Due {doc.dueDate}</div>
          )}
          {t.showPo && doc.poNumber && <div className="text-xs opacity-80">PO {doc.poNumber}</div>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-[#5b6b78]">Billed to</div>
          <div className="font-semibold">{doc.customer?.name ?? 'Choose a customer'}</div>
          {doc.customer?.gstin && <div className="text-xs text-[#5b6b78]">GSTIN {doc.customer.gstin}</div>}
          {doc.customer?.billingAddress && (
            <div className="text-xs whitespace-pre-line text-[#5b6b78]">{doc.customer.billingAddress}</div>
          )}
        </div>
        {doc.placeOfSupply && (
          <div className="sm:text-right">
            <div className="text-xs text-[#5b6b78]">Place of supply</div>
            <div className="font-medium">
              {GST_STATES[doc.placeOfSupply] ?? doc.placeOfSupply} ({doc.placeOfSupply})
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr
              className="text-xs font-semibold"
              style={{
                background: minimal ? '#eef1f3' : `${accent}1a`,
                borderBottom: minimal ? undefined : `2px solid ${accent}`,
              }}
            >
              <th className={cn('px-2', pad)}>Item</th>
              {t.showHsn && <th className={cn('px-2', pad)}>HSN/SAC</th>}
              <th className={cn('px-2 text-right', pad)}>Qty</th>
              {money && <th className={cn('px-2 text-right', pad)}>Rate</th>}
              {money && taxed && <th className={cn('px-2 text-right', pad)}>GST</th>}
              {money && <th className={cn('px-2 text-right', pad)}>Amount</th>}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-[#edf1f4]">
                <td className={cn('px-2', pad)}>{l.description || '—'}</td>
                {t.showHsn && <td className={cn('px-2 text-[#5b6b78]', pad)}>{l.hsn ?? ''}</td>}
                <td className={cn('px-2 text-right tabular-nums', pad)}>
                  {l.quantity}
                  {l.unit ? ` ${l.unit}` : ''}
                </td>
                {money && <td className={cn('px-2 text-right tabular-nums', pad)}>{inr(l.rate)}</td>}
                {money && taxed && <td className={cn('px-2 text-right tabular-nums', pad)}>{l.gstRate}%</td>}
                {money && <td className={cn('px-2 text-right tabular-nums', pad)}>{inr(l.amount)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {money && (
        <div className="ml-auto flex w-full max-w-72 flex-col gap-1.5">
          <Row label="Subtotal" value={doc.subtotal} />
          {t.showGstSplit ? (
            <>
              {doc.cgst > 0 && <Row label="CGST" value={doc.cgst} />}
              {doc.sgst > 0 && <Row label="SGST" value={doc.sgst} />}
              {doc.igst > 0 && <Row label="IGST" value={doc.igst} />}
            </>
          ) : (
            taxed && <Row label="GST" value={doc.cgst + doc.sgst + doc.igst} />
          )}
          <div
            className="flex justify-between border-t pt-2 text-[15px] font-bold"
            style={{ borderColor: minimal ? '#c9d2d9' : accent }}
          >
            <span>Total</span>
            <span className="tabular-nums">₹{inr(doc.total)}</span>
          </div>
        </div>
      )}
      {money && <div className="text-xs text-[#5b6b78]">{doc.amountInWords}</div>}

      {(doc.note || doc.terms) && (
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          {doc.note && (
            <div>
              <div className="font-semibold">Note</div>
              <div className="whitespace-pre-line text-[#5b6b78]">{doc.note}</div>
            </div>
          )}
          {doc.terms && (
            <div>
              <div className="font-semibold">Terms</div>
              <div className="whitespace-pre-line text-[#5b6b78]">{doc.terms}</div>
            </div>
          )}
        </div>
      )}

      {money && doc.seller && (t.showBank || t.showUpi) && (doc.seller.bankAccountNo || doc.seller.upiId) && (
        <div className="grid gap-1 rounded-md bg-[#f6f8f9] p-3 text-xs">
          {t.showBank && doc.seller.bankAccountNo && (
            <div>
              <span className="font-semibold">Bank</span> {doc.seller.bankName} · A/c{' '}
              {doc.seller.bankAccountNo} · IFSC {doc.seller.bankIfsc}
            </div>
          )}
          {t.showUpi && doc.seller.upiId && (
            <div>
              <span className="font-semibold">UPI</span> {doc.seller.upiId}
            </div>
          )}
        </div>
      )}
      {t.showSignatory && (
        <div className="ml-auto mt-4 w-48 border-t border-[#8a99a5] pt-1 text-center text-xs">
          Authorised signatory{doc.seller?.signatory ? ` · ${doc.seller.signatory}` : ''}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-[#5b6b78]">
      <span>{label}</span>
      <span className="tabular-nums">₹{inr(value)}</span>
    </div>
  );
}
