import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../app/session';
import { PhoneShell } from '../../components/shells';
import { Banner, ErrorNote, Pill, Spinner, Stepper } from '../../components/ui';
import { api, post } from '../../lib/api';
import { clock, kg, m3 } from '../../lib/format';
import type { Order, Product, StoreView } from '../../lib/types';

function useCutoffText(cutoffClosed: boolean, serviceDay: string) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (cutoffClosed) return { tone: 'warn' as const, title: `Orders for ${serviceDay} have closed`, body: 'Anything you order now joins the next run. It is not lost.' };
  const [h, m] = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }).split(':').map(Number);
  const left = 16 * 60 - (h! * 60 + m!);
  return left > 0
    ? { tone: 'mari' as const, title: `Order for ${serviceDay}`, body: `Cutoff today at 16:00, ${Math.floor(left / 60)} h ${left % 60} min left. Later orders go to the next run.` }
    : { tone: 'mari' as const, title: `Order for ${serviceDay}`, body: 'Cutoff is 16:00. In this demo the queue stays open until dispatch closes it.' };
}

/**
 * SM1 / SM1C. Replaces a phoned-in order with a structured one counted in cases and crates;
 * Waypoint works out weight and volume. Fresh outlets see dry and chilled goods as two orders,
 * because chilled goods travel on a refrigerated vehicle.
 */
export function SM1Order() {
  const { me } = useSession();
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<Product[]>('/store/products') });
  const view = useQuery({ queryKey: ['store-view'], queryFn: () => api<StoreView>('/store/view') });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [placed, setPlaced] = useState<{ orders: Order[]; requestedDay: string; afterCutoff: boolean; at: Date } | null>(null);

  useEffect(() => {
    if (products.data && Object.keys(qty).length === 0) {
      // Start from a typical order so the manager only adjusts.
      setQty(Object.fromEntries(products.data.map((p, i) => [p.id, i % 3 === 2 ? 0 : p.temp === 'chilled' ? 8 : 10])));
    }
  }, [products.data, qty]);

  const groups = useMemo(() => {
    const ps = products.data ?? [];
    return [
      { key: 'chilled', title: 'Chilled order', tone: 'cold' as const, note: 'Travels on a refrigerated truck, so it is placed as its own order.', items: ps.filter((p) => p.temp === 'chilled') },
      { key: 'ambient', title: me?.outletBrand === 'Fresh' ? 'Dry groceries order' : 'Order', tone: 'tea' as const, note: '', items: ps.filter((p) => p.temp === 'ambient') },
    ].filter((g) => g.items.length > 0);
  }, [products.data, me?.outletBrand]);

  const totals = useMemo(() => {
    let units = 0, w = 0, v = 0;
    for (const p of products.data ?? []) {
      const q = qty[p.id] ?? 0;
      units += q;
      w += q * p.weightKg;
      v += q * p.volumeM3;
    }
    return { units, w, v };
  }, [qty, products.data]);
  const orderCount = groups.filter((g) => g.items.some((p) => (qty[p.id] ?? 0) > 0)).length;

  const place = useMutation({
    mutationFn: () => post<{ orders: Order[]; requestedDay: string; afterCutoff: boolean }>('/store/orders', {
      lines: Object.entries(qty).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q })),
    }),
    onSuccess: (r) => {
      setPlaced({ ...r, at: new Date() });
      void qc.invalidateQueries({ queryKey: ['store-view'] });
    },
  });

  const cutoff = useCutoffText(view.data?.cutoffClosed ?? false, view.data?.serviceDay ?? '');
  const sub = `${me?.outletName ?? ''}, ${me?.outletId ?? ''}`;

  if (placed) {
    return (
      <PhoneShell title="Orders received" sub={sub} foot={<Link className="btn" to="/store" style={{ textAlign: 'center', textDecoration: 'none' }}>View deliveries</Link>}>
        <Banner tone="good" title={`${placed.orders.length === 2 ? 'Both orders' : 'Order'} received at ${clock(placed.at)}`}>
          {placed.afterCutoff ? `They join the run for ${placed.requestedDay}, the next one after the cutoff.` : `They are in tonight’s plan for ${placed.requestedDay}.`}
        </Banner>
        {placed.orders.map((o) => (
          <div className="card" key={o.id}>
            <div className="row">
              <h3>{o.orderNo}</h3>
              <Pill tone={o.temp === 'chilled' ? 'cold' : 'tea'}>{o.temp === 'chilled' ? 'Chilled' : me?.outletBrand === 'Fresh' ? 'Dry groceries' : 'Ambient'}</Pill>
            </div>
            <div className="sub">
              {o.units} cases and crates, {m3(o.volumeM3)}, {kg(o.weightKg)}
            </div>
          </div>
        ))}
        <div className="card">
          <h3>What happens next</h3>
          <div className="sub">Dispatch plans after the 16:00 cutoff. An arrival time appears on Deliveries once the plan is published, or a notice if an order moves to another day.</div>
        </div>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell
      title="New order"
      sub={sub}
      back="/store"
      backLabel="Deliveries"
      foot={
        <>
          <div className="small">
            <b>
              {totals.units} cases in {orderCount} order{orderCount === 1 ? '' : 's'}.
            </b>{' '}
            <span className="muted">
              Size calculated automatically: {m3(totals.v)}, about {kg(Math.round(totals.w / 10) * 10)}.
            </span>
          </div>
          <ErrorNote error={place.error} />
          <button className="btn" disabled={totals.units === 0 || place.isPending} onClick={() => place.mutate()}>
            {orderCount === 2 ? 'Place both orders' : 'Place order'}
          </button>
        </>
      }
    >
      <Banner tone={cutoff.tone} title={cutoff.title}>
        {cutoff.body}
      </Banner>
      {products.isLoading && <Spinner />}
      {groups.map((g) => {
        const count = g.items.reduce((s, p) => s + (qty[p.id] ?? 0), 0);
        return (
          <section className="card" key={g.key} aria-label={g.title}>
            <div className="row">
              <h3>{g.title}</h3>
              <Pill tone={g.tone}>{count} cases</Pill>
            </div>
            {g.note && <div className="sub">{g.note}</div>}
            <div className="list">
              {g.items.map((p) => (
                <div className="li" key={p.id}>
                  <div className="grow">
                    <div className="nm">{p.name}</div>
                    <div className="mt">per {p.unit}</div>
                  </div>
                  <Stepper label={p.name} value={qty[p.id] ?? 0} onChange={(v) => setQty((q) => ({ ...q, [p.id]: v }))} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </PhoneShell>
  );
}
