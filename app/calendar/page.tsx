"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar, Package, ArrowLeft, Factory, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";

interface CalendarOrder {
  id: string;
  name: string;
  detail: string;
  stage: string;
  member: string;
  shopify_id?: string;
  // Delivery
  delivery_date: string;
  delivery_window: string;
  delivery_notes: string;
  // Production
  production_start_date: string | null;
  production_est_finish_date: string | null;
}

type CalendarView = "production" | "delivery";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const today = new Date();
  const [view, setView] = useState<CalendarView>("production");
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [orders, setOrders] = useState<CalendarOrder[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<string | null>(null);

  // Delivery edit state
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editWindow, setEditWindow] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Production edit state
  const [editProdStart, setEditProdStart] = useState("");
  const [editProdFinish, setEditProdFinish] = useState("");

  const [saving, setSaving] = useState(false);
  const [shopifyStatus, setShopifyStatus] = useState<Record<string, "syncing" | "synced" | "error">>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchOrders(); }, []);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res = await fetch("/api/orders?type=order");
      const data = await res.json();
      if (data.data) setOrders(data.data);
    } catch {}
    setLoading(false);
  }

  async function saveDelivery(orderId: string) {
    setSaving(true);
    try {
      await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_date: editDeliveryDate || null,
          delivery_window: editWindow,
          delivery_notes: editNotes,
        }),
      });
      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, delivery_date: editDeliveryDate, delivery_window: editWindow, delivery_notes: editNotes }
        : o
      ));
      setEditingOrder(null);
    } catch {}
    setSaving(false);
  }

  async function saveProductionDates(orderId: string) {
    setSaving(true);
    const order = orders.find(o => o.id === orderId);
    const isShopify = !!order?.shopify_id;
    if (isShopify) setShopifyStatus(s => ({ ...s, [orderId]: "syncing" }));
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          production_start_date: editProdStart || null,
          production_est_finish_date: editProdFinish || null,
        }),
      });
      if (res.ok) {
        setOrders(prev => prev.map(o => o.id === orderId
          ? { ...o, production_start_date: editProdStart || null, production_est_finish_date: editProdFinish || null }
          : o
        ));
        if (isShopify) setShopifyStatus(s => ({ ...s, [orderId]: "synced" }));
      } else {
        if (isShopify) setShopifyStatus(s => ({ ...s, [orderId]: "error" }));
      }
      setEditingOrder(null);
    } catch {
      if (isShopify) setShopifyStatus(s => ({ ...s, [orderId]: "error" }));
    }
    setSaving(false);
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  function prevMonth() {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
    setSelectedDay(null);
  }

  const selectedDateStr = selectedDay ? toDateStr(currentYear, currentMonth, selectedDay) : null;

  const unscheduledProduction = orders.filter(
    o => o.stage === "In production" && !o.production_start_date && !o.production_est_finish_date
  );
  const unscheduledDelivery = orders.filter(
    o => !o.delivery_date && o.stage === "At cross dock"
  );

  function openEditProduction(o: CalendarOrder) {
    setEditingOrder(o.id);
    setEditProdStart(o.production_start_date || "");
    setEditProdFinish(o.production_est_finish_date || "");
  }
  function openEditDelivery(o: CalendarOrder, fallbackDate?: string) {
    setEditingOrder(o.id);
    setEditDeliveryDate(o.delivery_date || fallbackDate || "");
    setEditWindow(o.delivery_window || "");
    setEditNotes(o.delivery_notes || "");
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 md:px-6 py-3.5" style={{background:"rgba(30,42,53,0.85)",backdropFilter:"blur(40px)",WebkitBackdropFilter:"blur(40px)",borderBottom:"0.5px solid rgba(255,255,255,0.10)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.08)"}}>
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="w-px h-4 bg-[rgba(255,255,255,0.12)]" />
          <Calendar className="w-4 h-4 text-[rgba(232,227,218,0.50)]" />
          <h1 className="text-sm font-medium text-[#e8e3da]">Calendar</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] rounded-lg p-0.5">
            <button
              onClick={() => { setView("production"); setSelectedDay(null); }}
              className={clsx("flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                view === "production"
                  ? "bg-[rgba(255,255,255,0.10)] text-[#e8e3da]"
                  : "text-[rgba(232,227,218,0.40)] hover:text-[rgba(232,227,218,0.70)]"
              )}
            >
              <Factory className="w-3 h-3" />
              Production
            </button>
            <button
              onClick={() => { setView("delivery"); setSelectedDay(null); }}
              className={clsx("flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                view === "delivery"
                  ? "bg-[rgba(255,255,255,0.10)] text-[#e8e3da]"
                  : "text-[rgba(232,227,218,0.40)] hover:text-[rgba(232,227,218,0.70)]"
              )}
            >
              <Package className="w-3 h-3" />
              Delivery
            </button>
          </div>

          <button onClick={prevMonth} className="p-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-[#e8e3da] min-w-[140px] text-center font-medium">
            {MONTHS[currentMonth]} {currentYear}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] hover:border-[rgba(86,100,72,0.55)] transition-all">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Legend */}
      {view === "production" && (
        <div className="flex items-center gap-4 px-4 md:px-6 pt-3 pb-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
            <span className="text-[10px] text-[rgba(232,227,218,0.40)]">Production start</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span className="text-[10px] text-[rgba(232,227,218,0.40)]">Est. finish</span>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-0 lg:gap-4 p-4 md:p-6">
        {/* Calendar grid */}
        <div className="flex-1">
          <div className="grid grid-cols-7 mb-2">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = toDateStr(currentYear, currentMonth, day);
              const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
              const isSelected = day === selectedDay;

              const deliveryOrders = orders.filter(o => o.delivery_date === dateStr);
              const startOrders = orders.filter(o => o.production_start_date === dateStr);
              const finishOrders = orders.filter(o => o.production_est_finish_date === dateStr);
              const hasEvents = view === "delivery"
                ? deliveryOrders.length > 0
                : startOrders.length > 0 || finishOrders.length > 0;

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  className={clsx(
                    "min-h-[60px] md:min-h-[80px] p-1.5 rounded-lg border text-left transition-all",
                    isSelected ? "border-[rgba(86,100,72,0.55)] bg-[rgba(255,255,255,0.06)]" :
                    isToday ? "border-amber-800/60 bg-amber-950/20" :
                    hasEvents ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.04)] hover:border-[#3e3e3e]" :
                    "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] hover:border-[#3e3e3e]"
                  )}
                >
                  <span className={clsx("text-xs font-medium",
                    isToday ? "text-amber-400" : isSelected ? "text-[#e8e3da]" : "text-[rgba(232,227,218,0.50)]"
                  )}>{day}</span>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {view === "delivery" ? (
                      <>
                        {deliveryOrders.slice(0, 2).map(o => (
                          <div key={o.id} className="text-[9px] truncate bg-blue-900/40 text-blue-300 rounded px-1 py-0.5">
                            {o.id} · {o.name.split(" ")[0]}{o.delivery_window && ` · ${o.delivery_window}`}
                          </div>
                        ))}
                        {deliveryOrders.length > 2 && (
                          <div className="text-[9px] text-[rgba(232,227,218,0.30)]">+{deliveryOrders.length - 2}</div>
                        )}
                      </>
                    ) : (
                      <>
                        {startOrders.slice(0, 1).map(o => (
                          <div key={`s-${o.id}`} className="text-[9px] truncate bg-violet-900/40 text-violet-300 rounded px-1 py-0.5">
                            {o.id} · {o.name.split(" ")[0]}
                          </div>
                        ))}
                        {finishOrders.slice(0, 1).map(o => (
                          <div key={`f-${o.id}`} className="text-[9px] truncate bg-emerald-900/40 text-emerald-300 rounded px-1 py-0.5">
                            {o.id} · {o.name.split(" ")[0]}
                          </div>
                        ))}
                        {(startOrders.length + finishOrders.length) > 2 && (
                          <div className="text-[9px] text-[rgba(232,227,218,0.30)]">+{startOrders.length + finishOrders.length - 2}</div>
                        )}
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        <div className="lg:w-80 mt-4 lg:mt-0 flex flex-col gap-3">

          {/* Selected day */}
          {selectedDay && selectedDateStr && (() => {
            const dateStr = selectedDateStr;
            const deliveryOrders = orders.filter(o => o.delivery_date === dateStr);
            const startOrders = orders.filter(o => o.production_start_date === dateStr);
            const finishOrders = orders.filter(o => o.production_est_finish_date === dateStr);
            const productionOrders = [...new Map([...startOrders, ...finishOrders].map(o => [o.id, o])).values()];
            const panelOrders = view === "delivery" ? deliveryOrders : productionOrders;

            return (
              <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.10)]">
                  <p className="text-xs font-medium text-[#e8e3da]">
                    {MONTHS[currentMonth]} {selectedDay}, {currentYear}
                  </p>
                  <p className="text-[10px] text-[rgba(232,227,218,0.30)] mt-0.5">
                    {panelOrders.length === 0
                      ? `No ${view === "delivery" ? "deliveries" : "production events"}`
                      : `${panelOrders.length} order${panelOrders.length === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                  {panelOrders.length === 0 && (
                    <div className="p-4 text-center">
                      <p className="text-[11px] text-[rgba(232,227,218,0.30)]">
                        Nothing scheduled on this day
                      </p>
                    </div>
                  )}
                  {view === "delivery" && deliveryOrders.map(o => (
                    <DeliveryOrderCard
                      key={o.id}
                      order={o}
                      editing={editingOrder === o.id}
                      editDeliveryDate={editDeliveryDate}
                      editWindow={editWindow}
                      editNotes={editNotes}
                      saving={saving}
                      selectedDateStr={selectedDateStr}
                      onEdit={() => openEditDelivery(o, selectedDateStr)}
                      onCancel={() => setEditingOrder(null)}
                      onSave={() => saveDelivery(o.id)}
                      setEditDeliveryDate={setEditDeliveryDate}
                      setEditWindow={setEditWindow}
                      setEditNotes={setEditNotes}
                    />
                  ))}
                  {view === "production" && productionOrders.map(o => (
                    <ProductionOrderCard
                      key={o.id}
                      order={o}
                      dateStr={dateStr}
                      editing={editingOrder === o.id}
                      editProdStart={editProdStart}
                      editProdFinish={editProdFinish}
                      saving={saving}
                      shopifyStatus={shopifyStatus[o.id]}
                      onEdit={() => openEditProduction(o)}
                      onCancel={() => setEditingOrder(null)}
                      onSave={() => saveProductionDates(o.id)}
                      setEditProdStart={setEditProdStart}
                      setEditProdFinish={setEditProdFinish}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Unscheduled production */}
          {view === "production" && unscheduledProduction.length > 0 && (
            <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.10)] flex items-center gap-2">
                <Factory className="w-3.5 h-3.5 text-violet-400" />
                <p className="text-xs font-medium text-violet-400">In production — needs dates ({unscheduledProduction.length})</p>
              </div>
              <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                {unscheduledProduction.map(o => (
                  <div key={o.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-[#e8e3da]"><span className="text-[rgba(232,227,218,0.40)]">{o.id}</span> · {o.name}</p>
                      <p className="text-[10px] text-[rgba(232,227,218,0.50)]">{o.detail}</p>
                    </div>
                    <button onClick={() => { openEditProduction(o); setSelectedDay(null); }}
                      className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
                      Set dates →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unscheduled delivery */}
          {view === "delivery" && unscheduledDelivery.length > 0 && (
            <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.10)] flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-amber-400" />
                <p className="text-xs font-medium text-amber-400">Needs scheduling ({unscheduledDelivery.length})</p>
              </div>
              <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                {unscheduledDelivery.map(o => (
                  <div key={o.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-[#e8e3da]"><span className="text-[rgba(232,227,218,0.40)]">{o.id}</span> · {o.name}</p>
                    </div>
                    <button onClick={() => { openEditDelivery(o); setSelectedDay(null); }}
                      className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors">
                      Schedule →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inline edit panel (no selected day) */}
          {editingOrder && !selectedDay && (() => {
            const o = orders.find(ord => ord.id === editingOrder);
            if (!o) return null;

            if (view === "production") {
              return (
                <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] rounded-xl p-4">
                  <p className="text-xs font-medium text-[#e8e3da] mb-1">Set production dates — {o.name}</p>
                  {o.shopify_id && (
                    <p className="text-[10px] text-violet-400 mb-3">Shopify order · dates will sync automatically</p>
                  )}
                  <div className="flex flex-col gap-2">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Production start date</label>
                      <input type="date" value={editProdStart} onChange={e => setEditProdStart(e.target.value)} className="w-full field-input text-xs py-1.5 px-2" />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Est. finish date</label>
                      <input type="date" value={editProdFinish} onChange={e => setEditProdFinish(e.target.value)} className="w-full field-input text-xs py-1.5 px-2" />
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => setEditingOrder(null)} className="flex-1 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">Cancel</button>
                      <button onClick={() => saveProductionDates(o.id)} disabled={saving || (!editProdStart && !editProdFinish)}
                        className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50 transition-all">
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] rounded-xl p-4">
                <p className="text-xs font-medium text-[#e8e3da] mb-3">Schedule delivery — {o.name}</p>
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Date</label>
                    <input type="date" value={editDeliveryDate} onChange={e => setEditDeliveryDate(e.target.value)} className="w-full field-input text-xs py-1.5 px-2" />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Time window</label>
                    <select value={editWindow} onChange={e => setEditWindow(e.target.value)} className="w-full field-input text-xs py-1.5 px-2 appearance-none">
                      <option value="">— Select —</option>
                      <option value="AM">Morning (AM)</option>
                      <option value="PM">Afternoon (PM)</option>
                      <option value="8am-10am">8am – 10am</option>
                      <option value="10am-12pm">10am – 12pm</option>
                      <option value="12pm-2pm">12pm – 2pm</option>
                      <option value="2pm-4pm">2pm – 4pm</option>
                      <option value="4pm-6pm">4pm – 6pm</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Notes</label>
                    <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} placeholder="Gate code, access instructions..." className="w-full field-input text-xs py-1.5 px-2 resize-none" />
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => setEditingOrder(null)} className="flex-1 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">Cancel</button>
                    <button onClick={() => saveDelivery(o.id)} disabled={saving || !editDeliveryDate}
                      className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50 transition-all">
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProductionOrderCard({
  order, dateStr, editing, editProdStart, editProdFinish, saving, shopifyStatus,
  onEdit, onCancel, onSave, setEditProdStart, setEditProdFinish,
}: {
  order: CalendarOrder;
  dateStr: string;
  editing: boolean;
  editProdStart: string;
  editProdFinish: string;
  saving: boolean;
  shopifyStatus?: "syncing" | "synced" | "error";
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  setEditProdStart: (v: string) => void;
  setEditProdFinish: (v: string) => void;
}) {
  const isStart = order.production_start_date === dateStr;
  const isFinish = order.production_est_finish_date === dateStr;

  return (
    <div className="p-4">
      {editing ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-[#e8e3da]"><span className="text-[rgba(232,227,218,0.40)]">{order.id}</span> · {order.name}</p>
          {order.shopify_id && (
            <p className="text-[10px] text-violet-400">Shopify order · dates will sync automatically</p>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Production start date</label>
            <input type="date" value={editProdStart} onChange={e => setEditProdStart(e.target.value)} className="w-full field-input text-xs py-1.5 px-2" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Est. finish date</label>
            <input type="date" value={editProdFinish} onChange={e => setEditProdFinish(e.target.value)} className="w-full field-input text-xs py-1.5 px-2" />
          </div>
          <div className="flex gap-2 mt-1">
            <button onClick={onCancel} className="flex-1 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">Cancel</button>
            <button onClick={onSave} disabled={saving}
              className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#e8e3da] truncate"><span className="text-[rgba(232,227,218,0.40)]">{order.id}</span> · {order.name}</p>
              <p className="text-[10px] text-[rgba(232,227,218,0.50)] mt-0.5 truncate">{order.detail}</p>
              <div className="flex flex-col gap-0.5 mt-1.5">
                {isStart && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                    <span className="text-[10px] text-violet-300">Started {order.production_start_date}</span>
                  </div>
                )}
                {isFinish && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-[10px] text-emerald-300">Est. finish {order.production_est_finish_date}</span>
                  </div>
                )}
              </div>
              {order.shopify_id && (
                <div className="mt-1.5">
                  {shopifyStatus === "syncing" && <span className="text-[9px] text-violet-400">Syncing to Shopify…</span>}
                  {shopifyStatus === "synced" && (
                    <span className="text-[9px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5" />Synced to Shopify
                    </span>
                  )}
                  {shopifyStatus === "error" && <span className="text-[9px] text-red-400">Shopify sync failed</span>}
                  {!shopifyStatus && <span className="text-[9px] text-[rgba(232,227,218,0.25)]">Shopify order</span>}
                </div>
              )}
            </div>
            <button onClick={onEdit} className="text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors ml-2 shrink-0">
              Edit
            </button>
          </div>
          <span className={clsx("inline-block text-[9px] mt-1.5 px-1.5 py-0.5 rounded",
            order.stage === "In production" ? "bg-blue-900/40 text-blue-300" : "bg-[rgba(255,255,255,0.06)] text-[rgba(232,227,218,0.40)]"
          )}>{order.stage}</span>
        </div>
      )}
    </div>
  );
}

function DeliveryOrderCard({
  order, editing, editDeliveryDate, editWindow, editNotes, saving, selectedDateStr,
  onEdit, onCancel, onSave, setEditDeliveryDate, setEditWindow, setEditNotes,
}: {
  order: CalendarOrder;
  editing: boolean;
  editDeliveryDate: string;
  editWindow: string;
  editNotes: string;
  saving: boolean;
  selectedDateStr: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  setEditDeliveryDate: (v: string) => void;
  setEditWindow: (v: string) => void;
  setEditNotes: (v: string) => void;
}) {
  return (
    <div className="p-4">
      {editing ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-[#e8e3da]"><span className="text-[rgba(232,227,218,0.40)]">{order.id}</span> · {order.name}</p>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Delivery date</label>
            <input type="date" value={editDeliveryDate} onChange={e => setEditDeliveryDate(e.target.value)} className="w-full field-input text-xs py-1.5 px-2" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Time window</label>
            <select value={editWindow} onChange={e => setEditWindow(e.target.value)} className="w-full field-input text-xs py-1.5 px-2 appearance-none">
              <option value="">— Select —</option>
              <option value="AM">Morning (AM)</option>
              <option value="PM">Afternoon (PM)</option>
              <option value="8am-10am">8am – 10am</option>
              <option value="10am-12pm">10am – 12pm</option>
              <option value="12pm-2pm">12pm – 2pm</option>
              <option value="2pm-4pm">2pm – 4pm</option>
              <option value="4pm-6pm">4pm – 6pm</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Notes</label>
            <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} placeholder="Gate code, access instructions..." className="w-full field-input text-xs py-1.5 px-2 resize-none" />
          </div>
          <div className="flex gap-2 mt-1">
            <button onClick={onCancel} className="flex-1 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">Cancel</button>
            <button onClick={onSave} disabled={saving}
              className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-[#e8e3da]"><span className="text-[rgba(232,227,218,0.40)]">{order.id}</span> · {order.name}</p>
              <p className="text-[10px] text-[rgba(232,227,218,0.50)] mt-0.5">{order.detail}</p>
              {order.delivery_window && <p className="text-[10px] text-amber-400 mt-1">{order.delivery_window}</p>}
              {order.delivery_notes && <p className="text-[10px] text-[rgba(232,227,218,0.30)] mt-1">{order.delivery_notes}</p>}
            </div>
            <button onClick={onEdit} className="text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors ml-2 shrink-0">
              Edit
            </button>
          </div>
          <span className={clsx("inline-block text-[9px] mt-1.5 px-1.5 py-0.5 rounded",
            order.stage === "Delivered" ? "bg-green-900/40 text-green-400" : "bg-amber-900/40 text-amber-400"
          )}>{order.stage}</span>
        </div>
      )}
    </div>
  );
}
