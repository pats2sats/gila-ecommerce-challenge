# Implementation plan

A single Fastify application serves a React interface and JSON API backed by PostgreSQL. Compose runs the application and database; the database data lives in a named volume.

1. Define project scope and architecture.
2. Add container infrastructure and reproducible dependencies.
3. Build the HTTP and database foundation.
4. Validate and persist products and expose paginated search.
5. Import the supplied CSV with explicit outcomes and safe re-import.
6. Save simulated orders and decrement stock atomically.
7. Provide a catalog, inventory editor, import feedback and checkout UI.
8. Verify the supplied dataset and overlapping checkout requests, and document setup and trade-offs.

Products use a stable numeric ID and a unique canonical SKU. Money is stored as integer cents; stock is a nonnegative integer. The importer ignores the source index, validates before inserting, and never updates an existing SKU. Orders retain product names, SKUs and prices even when products change. This is a local, single-operator demo; no external payment processing or user accounts.
