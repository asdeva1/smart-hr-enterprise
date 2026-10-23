-- Journals that come from vendor bills and payments.
ALTER TYPE "journal_source" ADD VALUE 'PURCHASE_BILL';
ALTER TYPE "journal_source" ADD VALUE 'VENDOR_PAYMENT';
