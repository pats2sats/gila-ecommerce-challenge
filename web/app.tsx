import React, { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type ProductData = { name: string; sku: string; description: string; category: string; price: string; stock: number; weight_kg: string };
type Product = ProductData & { id: number };
type Listing = { items: Product[]; hasMore: boolean };
type Report = { processed: number; inserted: number; skipped: number; issues: { row: number; sku: string; status: string; message: string }[] };
type Order = { id: string; totalCents: number };
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const empty: ProductData = { name: '', sku: '', description: '', category: '', price: '', stock: 0, weight_kg: '' };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.details ? payload.details.map((d: {field: string; message: string}) => `${d.field}: ${d.message}`).join('; ') : payload.error);
  return payload as T;
}

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function App() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<Listing>({items: [], hasMore: false});
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'shop' | 'inventory'>('shop');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState(empty);
  const [report, setReport] = useState<Report>();
  const [basket, setBasket] = useState<Record<number, { product: Product; quantity: number }>>({});
  const lines = Object.values(basket);
  const count = lines.reduce((sum, item) => sum + item.quantity, 0);
  const reload = () => setRevision(value => value + 1);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void api<Listing>(`/api/products?q=${encodeURIComponent(q)}&page=${page}`).then(value => {
        if (!ignore) {
          if (value.items.length === 0 && page > 1) setPage(page - 1);
          setList(value);
        }
      }).catch(e => { if (!ignore) setError(String(e.message)); })
        .finally(() => { if (!ignore) setLoading(false); });
    }, 150);
    return () => { ignore = true; clearTimeout(timer); };
  }, [q, page, revision]);

  async function action(task: () => Promise<void>) {
    setError('');
    setNotice('');
    setWorking(true);
    try { await task(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { setWorking(false); }
  }

  function edit(product?: Product) {
    setEditing(product?.id ?? 'new');
    if (product) {
      const { id: _id, ...data } = product;
      setDraft(data);
    } else setDraft(empty);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      await api(editing === 'new' ? '/api/products' : `/api/products/${editing}`, json(editing === 'new' ? 'POST' : 'PUT', draft));
      setEditing(null);
      setNotice('Product saved.');
      reload();
    });
  }

  async function remove(product: Product) {
    if (!window.confirm(`Delete ${product.name} from the catalog?`)) return;
    await action(async () => {
      await api(`/api/products/${product.id}`, { method: 'DELETE' });
      changeQuantity(product, 0);
      if (editing === product.id) setEditing(null);
      setNotice('Product deleted.');
      reload();
    });
  }

  function changeQuantity(product: Product, quantity: number) {
    setBasket(previous => {
      const next = {...previous};
      if (quantity <= 0) delete next[product.id];
      else next[product.id] = {product, quantity: Math.min(product.stock, 1000, quantity)};
      return next;
    });
  }

  async function checkout() {
    await action(async () => {
      const order = await api<Order>('/api/orders', json('POST', { items: lines.map(({product, quantity}) => ({productId: product.id, quantity})) }));
      setBasket({});
      setNotice(`Order ${order.id.slice(0, 8)} placed for ${money(order.totalCents / 100)}. No money was charged.`);
      reload();
    });
  }

  async function upload(file?: File) {
    if (!file) return;
    setReport(undefined);
    await action(async () => {
      const outcome = await api<Report>('/api/products/import', {method: 'POST', headers: {'content-type': 'text/csv'}, body: file});
      setReport(outcome);
      setNotice(`Imported ${outcome.inserted} products; skipped ${outcome.skipped} of ${outcome.processed} rows.`);
      reload();
    });
  }

  const labels = { name: 'Product name', sku: 'SKU', description: 'Description', category: 'Category', price: 'Price (USD)', stock: 'Stock', weight_kg: 'Weight (kg)' };
  return <>
    <header><div className="bar"><a className="brand" href="/">FIELDSTOCK<span>COMMERCE</span></a><nav aria-label="Main navigation">
      <button className={view === 'shop' ? 'active' : ''} onClick={() => { setView('shop'); setEditing(null); }}>Shop · {count}</button>
      <button className={view === 'inventory' ? 'active' : ''} onClick={() => setView('inventory')}>Inventory</button>
    </nav></div></header>
    <main>
      <section className="hero"><p className="eyebrow">CATALOG OPERATIONS</p><h1>{view === 'shop' ? 'Shop the catalog' : 'Manage inventory'}</h1>
      <p>{view === 'shop' ? 'Find products and place a simulated order.' : 'Maintain product details, stock and prices in one place.'}</p></section>
      {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message" role="status">{notice}</p>}
      <div className={view === 'shop' ? 'layout shop' : 'layout'}>
        <section aria-label="Products">
          <div className="controls"><label>Search products<input type="search" placeholder="Name, SKU, category or description" value={q} onChange={e => {setQ(e.target.value);setPage(1);}}/></label>
          {view === 'inventory' && <button className="primary" onClick={() => edit()}>New product</button>}</div>
          {view === 'inventory' && <section className="panel"><label>Import products from CSV<input disabled={working} type="file" accept=".csv,text/csv" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void upload(file); }}/></label>
            {report && <details open><summary>{report.inserted} inserted · {report.skipped} skipped</summary>
              <ul>{report.issues.map(item => <li key={item.row}>Line {item.row} {item.sku && `· ${item.sku}`}: {item.message}</li>)}</ul></details>}
          </section>}
          {editing !== null && view === 'inventory' && <form className="panel editor" onSubmit={save}><h2>{editing === 'new' ? 'New product' : 'Edit product'}</h2>
            {Object.entries(labels).map(([name, label]) => {
              const key = name as keyof ProductData;
              return <label key={key}>{label}{key === 'description' ? <textarea value={draft.description} onChange={e => setDraft({...draft, description: e.target.value})}/> :
                <input required value={draft[key]} type={key === 'stock' ? 'number' : 'text'} min={key === 'stock' ? 0 : undefined} inputMode={key === 'price' || key === 'weight_kg' ? 'decimal' : undefined} onChange={e => setDraft({...draft, [key]: key === 'stock' ? Number(e.target.value) : e.target.value})}/>}</label>;
            })}<div className="actions"><button className="primary" disabled={working}>Save product</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div></form>}
          {loading && <p role="status">Loading products…</p>}
          {!loading && !list.items.length && <div className="panel">{q ? 'No products match that search.' : 'No products yet. Add or import stock in Inventory.'}</div>}
          <div className="cards">{list.items.map(product => <article className="panel product" key={product.id}>
            <p className="eyebrow">{product.category} · {product.sku}</p><h2>{product.name}</h2><p className="description">{product.description}</p>
            <p><strong>{money(Number(product.price))}</strong> <span className="subtle">· {product.stock} in stock · {Number(product.weight_kg)} kg</span></p>
            {view === 'inventory' ? <div className="actions"><button onClick={() => edit(product)}>Edit</button><button disabled={working} onClick={() => void remove(product)}>Delete</button></div> :
              <button className="primary" disabled={working || product.stock <= (basket[product.id]?.quantity ?? 0)} onClick={() => changeQuantity(product, (basket[product.id]?.quantity ?? 0) + 1)}>{product.stock === 0 ? 'Out of stock' : 'Add to cart'}</button>}
          </article>)}</div>
          {(page > 1 || list.hasMore) && <div className="controls pages"><button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button disabled={!list.hasMore || loading} onClick={() => setPage(page + 1)}>Next</button></div>}
        </section>
        {view === 'shop' && <aside className="panel cart"><h2>Your cart</h2>
          {lines.length === 0 ? <p className="subtle">Nothing in your cart yet.</p> : <>
            <ul>{lines.map(({product, quantity}) => <li key={product.id}><span>{product.name} × {quantity}</span><button disabled={working} onClick={() => changeQuantity(product, quantity - 1)} aria-label={`Remove one ${product.name}`}>−</button></li>)}</ul>
            <p><strong>Estimated total: {money(lines.reduce((sum, line) => sum + Math.round(Number(line.product.price) * 100) * line.quantity, 0) / 100)}</strong></p>
            <button className="primary" disabled={working} onClick={() => void checkout()}>Place simulated order</button></>}
        </aside>}
      </div>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
