-- Journals that come from sales documents and customer receipts.
ALTER TYPE "journal_source" ADD VALUE 'SALES_DOCUMENT';
ALTER TYPE "journal_source" ADD VALUE 'SALES_RECEIPT';
