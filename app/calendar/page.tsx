"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar, Package, ArrowLeft } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";

interface DeliveryOrder {
  id: string;
  name: string;
  detail: string;
  delivery_date: string;
  delivery_window: string;
  delivery_notes: string;
  member: string;
  stage: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function CalendarPage() {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editWindow, setEditWindow] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setLoading(true);
    try {
      const res = await fetch("/api/orders?type=order");
      const data = await res.json();
      if (data.data) {
        setOrders(data.data.filter((o: DeliveryOrder) =>
          o.stage === "At cross dock" || o.stage === "Delivered" || o.delivery_date
        ));
      }
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
          delivery_date: editDate || null,
          delivery_window: editWindow,
          delivery_notes: editNotes,
        }),
      });
      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, delivery_date: editDate, delivery_window: editWindow, delivery_notes: editNotes }
        : o
      ));
      setEditingOrder(null);
    } catch {}
    setSaving(false);
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  function ordersOnDay(day: number): DeliveryOrder[] {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return orders.filter(o => o.delivery_date === dateStr);
  }

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

  const selectedDateStr = selectedDay
    ? `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : null;
  const selectedOrders = selectedDay ? ordersOnDay(selectedDay) : [];

  // Orders without a delivery date (need scheduling)
  const unscheduled = orders.filter(o => !o.delivery_date && o.stage === "At cross dock");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 md:px-6 py-3.5" style={{background:"rgba(30,42,53,0.85)",backdropFilter:"blur(40px)",WebkitBackdropFilter:"blur(40px)",borderBottom:"0.5px solid rgba(255,255,255,0.10)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.08)"}}>
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-xs text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="w-px h-4 bg-[rgba(255,255,255,0.12)]" />
          <Calendar className="w-4 h-4 text-[rgba(232,227,218,0.50)]" />
          <h1 className="text-sm font-medium text-[#e8e3da]">Delivery calendar</h1>
        </div>
        <div className="flex items-center gap-2">
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
              const dayOrders = ordersOnDay(day);
              const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
              const isSelected = day === selectedDay;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  className={clsx(
                    "min-h-[60px] md:min-h-[80px] p-1.5 rounded-lg border text-left transition-all",
                    isSelected ? "border-[rgba(86,100,72,0.55)] bg-[rgba(255,255,255,0.06)]" :
                    isToday ? "border-amber-800/60 bg-amber-950/20" :
                    "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] hover:border-[#3e3e3e]"
                  )}
                >
                  <span className={clsx(
                    "text-xs font-medium",
                    isToday ? "text-amber-400" : isSelected ? "text-[#e8e3da]" : "text-[rgba(232,227,218,0.50)]"
                  )}>{day}</span>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {dayOrders.slice(0, 2).map(o => (
                      <div key={o.id} className="text-[9px] truncate bg-blue-900/40 text-blue-300 rounded px-1 py-0.5">
                        {o.name.split(" ")[0]}
                        {o.delivery_window && ` · ${o.delivery_window}`}
                      </div>
                    ))}
                    {dayOrders.length > 2 && (
                      <div className="text-[9px] text-[rgba(232,227,218,0.30)]">+{dayOrders.length - 2} more</div>
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
          {selectedDay && (
            <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.10)]">
                <p className="text-xs font-medium text-[#e8e3da]">
                  {MONTHS[currentMonth]} {selectedDay}, {currentYear}
                </p>
                <p className="text-[10px] text-[rgba(232,227,218,0.30)] mt-0.5">
                  {selectedOrders.length === 0 ? "No deliveries scheduled" : `${selectedOrders.length} deliver${selectedOrders.length === 1 ? "y" : "ies"}`}
                </p>
              </div>
              <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                {selectedOrders.map(o => (
                  <div key={o.id} className="p-4">
                    {editingOrder === o.id ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-medium text-[#e8e3da]">{o.name}</p>
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Delivery date</label>
                          <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                            className="w-full field-input text-xs py-1.5 px-2" />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Time window</label>
                          <select value={editWindow} onChange={e => setEditWindow(e.target.value)}
                            className="w-full field-input text-xs py-1.5 px-2 appearance-none">
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
                          <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                            rows={2} placeholder="Gate code, access instructions..."
                            className="w-full field-input text-xs py-1.5 px-2 resize-none" />
                        </div>
                        <div className="flex gap-2 mt-1">
                          <button onClick={() => setEditingOrder(null)} className="flex-1 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">Cancel</button>
                          <button onClick={() => saveDelivery(o.id)} disabled={saving}
                            className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50 transition-all">
                            {saving ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs font-medium text-[#e8e3da]">{o.name}</p>
                            <p className="text-[10px] text-[rgba(232,227,218,0.50)] mt-0.5">{o.detail}</p>
                            {o.delivery_window && (
                              <p className="text-[10px] text-amber-400 mt-1">{o.delivery_window}</p>
                            )}
                            {o.delivery_notes && (
                              <p className="text-[10px] text-[rgba(232,227,218,0.30)] mt-1">{o.delivery_notes}</p>
                            )}
                          </div>
                          <button onClick={() => {
                            setEditingOrder(o.id);
                            setEditDate(o.delivery_date || selectedDateStr || "");
                            setEditWindow(o.delivery_window || "");
                            setEditNotes(o.delivery_notes || "");
                          }} className="text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors ml-2 shrink-0">
                            Edit
                          </button>
                        </div>
                        <span className={clsx("inline-block text-[9px] mt-1.5 px-1.5 py-0.5 rounded",
                          o.stage === "Delivered" ? "bg-green-900/40 text-green-400" : "bg-amber-900/40 text-amber-400"
                        )}>{o.stage}</span>
                      </div>
                    )}
                  </div>
                ))}
                {selectedOrders.length === 0 && (
                  <div className="p-4 text-center">
                    <p className="text-[11px] text-[rgba(232,227,218,0.30)]">No deliveries on this day</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Unscheduled orders */}
          {unscheduled.length > 0 && (
            <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.10)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.10)] flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-amber-400" />
                <p className="text-xs font-medium text-amber-400">Needs scheduling ({unscheduled.length})</p>
              </div>
              <div className="divide-y divide-[rgba(255,255,255,0.08)]">
                {unscheduled.map(o => (
                  <div key={o.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-[#e8e3da]">{o.name}</p>
                      <p className="text-[10px] text-[rgba(232,227,218,0.50)]">{o.id}</p>
                    </div>
                    <button onClick={() => {
                      setEditingOrder(o.id);
                      setEditDate("");
                      setEditWindow("");
                      setEditNotes("");
                      setSelectedDay(null);
                    }} className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors">
                      Schedule →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule inline for unscheduled */}
          {editingOrder && !selectedOrders.find(o => o.id === editingOrder) && (
            (() => {
              const o = orders.find(ord => ord.id === editingOrder);
              if (!o) return null;
              return (
                <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] rounded-xl p-4">
                  <p className="text-xs font-medium text-[#e8e3da] mb-3">Schedule delivery — {o.name}</p>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Date</label>
                      <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="w-full field-input text-xs py-1.5 px-2" />
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
                      <button onClick={() => saveDelivery(o.id)} disabled={saving || !editDate}
                        className="flex-1 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50 transition-all">
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
