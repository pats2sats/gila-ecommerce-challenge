# Known limitations and input issues

- The sample contains conflicting entries for RS-001 and BS-021, one identical duplicate ignoring its source index, and seven invalid records. The import report identifies the affected lines. A file with broken CSV quoting is rejected before any inserts.
- This is a local, single-operator demo. There are no accounts, authorization, real payments, durable cart, or order management UI. Do not expose the server publicly as-is.
- Checkout saves current server prices rather than trusting cart estimates. Automatic retries are avoided; repeated deliberate submissions can create additional orders when stock exists.
- Inventory updates replace an entire product. If multiple administrators edit stock concurrently, a stale edit can overwrite a newer absolute count; production inventory should use versioned writes or stock movements.
