# Fieldstock Commerce

A local e-commerce demo with a searchable catalog, inventory management, CSV import, and simulated checkout.

## Start

```sh
docker compose up --build
```

Open http://localhost:3000. Go to **Inventory**, choose **Import products from CSV**, and select `data/products.csv`. Then return to **Shop**, search for a product, add it to the cart and place a simulated order. No real payment information is requested. Use `docker compose down` to stop the app; add `-v` only if you want to delete the catalog and orders.

For a non-container run, use Node 24 and a running PostgreSQL instance:

```sh
npm ci
npm run build
DATABASE_URL=postgres://user:password@127.0.0.1:5432/commerce npm start
```

The database must already exist; the app applies its schema on startup. Local dev knowledge: run `npm run build` again after changing the UI.

## Decisions

- **One application, one database.** Fastify handles HTTP and serves the built React UI on the same origin; Vite builds static assets. A separate frontend service or microservices would add deployments without helping this workflow.
- **PostgreSQL over SQLite or a document store.** Unique SKU and nonnegative stock constraints are enforced in the database. Checkout locks requested products in ID order, uses current prices, and commits the order snapshot and stock updates together. Money is stored in integer cents. A multi-line order either succeeds in full or changes nothing.
- **Readable SQL over an ORM.** Parameterized, bounded queries make the constraints and transaction behavior explicit. Search is case-insensitive and literal across SKU, name, category and description, with stable pagination. Substring scans are appropriate for this catalog size; a large deployment could add trigram indexes or a search service.
- **Insert-only import over upsert.** Re-uploading a file must not undo a sale or an operator's product edits. Ignore the CSV's source index, normalize SKU case, accept whole stock written with a decimal zero suffix and prices prefixed with a dollar sign or marked `free`. Keep the first valid occurrence, record duplicates and conflicts separately, and continue past invalid rows. SKU identity is enforced for all writes.

## Example file

The supplied CSV was downloaded on **November 24, 2026**. On an empty catalog, the file contains 97 records: 87 inserted, 7 invalid, 1 identical duplicate, and 2 conflicting SKU rows. A repeat import inserts no products. See [known limitations](KNOWN_ISSUES.md).

## API

| Method | Path | Behavior |
|---|---|---|
| GET | /api/health | Database readiness |
| GET | /api/products?q=&page=1&limit=20 | Search and paginate |
| GET, PUT, DELETE | /api/products/:id | Read, replace or delete a product |
| POST | /api/products | Create a product |
| POST | /api/products/import | Raw UTF-8 CSV with Content-Type text/csv |
| POST | /api/orders | Place an order with items [{productId, quantity}] |

Product prices and weights in API payloads are decimal strings; stock is an integer. An order response includes integer cents and simulated payment status. The API does not accept payment details.

## Verification

```sh
npm run typecheck
npm run build
npm test
TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/testdb npm test
```

The database suite creates and drops an isolated schema. It verifies CRUD, literal search, real file import, no restocking on re-import, concurrent purchase of the last unit, rollback on a mixed cart, and data persistence after reconnecting.
