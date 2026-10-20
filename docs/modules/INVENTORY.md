# Inventory

Items, warehouses and a stock ledger (feature `inventory`; permissions `inventory.view` and `inventory.manage`).

- **Items** have a unique SKU, a unit, an optional reorder level and a value per unit.
- **Warehouses** belong to a company and can be archived (no more stock goes in).
- **Stock** is never edited directly. Every change is a row in an append-only ledger: receipt, issue, transfer out/in or a count adjustment. On hand is the sum of the ledger.
- **Never below zero**: a database trigger takes a per item and warehouse lock and refuses any movement that would go negative, so two people issuing at once cannot oversell. The API reports this as `INSUFFICIENT_STOCK` (409).
- **Transfers** write a matching out and in pair in one transaction.
- **Low stock** lists items at or below their reorder level (`GET /v1/inventory/stock?lowOnly=true`).
- Included in the organisation data export. Not available on the Lite plan.
