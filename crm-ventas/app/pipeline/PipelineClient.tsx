"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, MessageCircle, Phone, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { PipelineColumn } from "@/lib/settings";

type Card = {
  id: string;
  name: string;
  phone: string | null;
  stage: string;
  order: number;
  source: string;
  nextAppointment: string | null;
};

const SOURCE_ICON: Record<string, React.ReactNode> = {
  whatsapp: <MessageCircle size={13} className="text-emerald-500" />,
  llamada: <Phone size={13} className="text-brand-500" />,
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ContactCard({
  card,
  onDelete,
  dragging,
}: {
  card: Card;
  onDelete?: (id: string) => void;
  dragging?: boolean;
}) {
  return (
    <div
      className={clsx(
        "group card cursor-grab p-3 active:cursor-grabbing",
        dragging && "rotate-2 shadow-lg"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{card.name}</div>
          {card.phone && (
            <div className="truncate text-xs text-slate-500">{card.phone}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {SOURCE_ICON[card.source]}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(card.id);
              }}
              className="hidden text-slate-300 hover:text-red-500 group-hover:block"
              title="Eliminar"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {card.nextAppointment && (
        <div className="mt-2 flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
          <CalendarClock size={12} />
          {fmtDate(card.nextAppointment)}
        </div>
      )}
    </div>
  );
}

function SortableCard({
  card,
  onDelete,
}: {
  card: Card;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, data: { type: "card", card } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <ContactCard card={card} onDelete={onDelete} />
    </div>
  );
}

function Column({
  column,
  cards,
  onDelete,
  onAdd,
}: {
  column: PipelineColumn;
  cards: Card[];
  onDelete: (id: string) => void;
  onAdd: (stage: string) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column", columnId: column.id },
  });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70 p-2">
      <div className="mb-2 flex items-center justify-between px-2 pt-1">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: column.color }}
          />
          <span className="text-sm font-semibold">{column.label}</span>
          <span className="rounded-full bg-white px-2 text-xs text-slate-500">
            {cards.length}
          </span>
        </div>
        <button
          onClick={() => onAdd(column.id)}
          className="text-slate-400 hover:text-brand-600"
          title="Añadir contacto"
        >
          <Plus size={16} />
        </button>
      </div>
      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="flex min-h-[60px] flex-1 flex-col gap-2 p-1">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} onDelete={onDelete} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export default function PipelineClient({
  columns,
  initialCards,
}: {
  columns: PipelineColumn[];
  initialCards: Card[];
}) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [active, setActive] = useState<Card | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const byColumn = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const col of columns) map.set(col.id, []);
    for (const c of cards) {
      if (!map.has(c.stage)) map.set(c.stage, []);
      map.get(c.stage)!.push(c);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [cards, columns]);

  function findCard(id: string) {
    return cards.find((c) => c.id === id) ?? null;
  }

  function targetColumnOf(overId: string, overData: any): string | null {
    if (overData?.type === "column") return overData.columnId;
    if (overData?.type === "card") return (overData.card as Card).stage;
    const c = findCard(overId);
    return c?.stage ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    setActive(findCard(String(e.active.id)));
  }

  function onDragOver(e: DragOverEvent) {
    const { active: a, over } = e;
    if (!over) return;
    const activeCard = findCard(String(a.id));
    if (!activeCard) return;
    const targetCol = targetColumnOf(String(over.id), over.data.current);
    if (targetCol && targetCol !== activeCard.stage) {
      setCards((prev) =>
        prev.map((c) => (c.id === activeCard.id ? { ...c, stage: targetCol } : c))
      );
    }
  }

  async function persist(updated: Card[]) {
    const updates = updated.map((c) => ({ id: c.id, stage: c.stage, order: c.order }));
    try {
      await fetch("/api/v1/pipeline/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
    } catch {
      // El estado optimista se mantiene; en el peor caso un refresh recarga de BD
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const { active: a, over } = e;
    setActive(null);
    if (!over) return;
    const activeCard = findCard(String(a.id));
    if (!activeCard) return;

    const targetCol =
      targetColumnOf(String(over.id), over.data.current) ?? activeCard.stage;

    setCards((prev) => {
      const next = prev.map((c) =>
        c.id === activeCard.id ? { ...c, stage: targetCol } : c
      );
      // Recolocar dentro de la columna destino
      const colCards = next
        .filter((c) => c.stage === targetCol && c.id !== activeCard.id)
        .sort((x, y) => x.order - y.order);
      const overCard =
        over.data.current?.type === "card" ? (over.data.current.card as Card) : null;
      let insertAt = colCards.length;
      if (overCard && overCard.id !== activeCard.id) {
        const idx = colCards.findIndex((c) => c.id === overCard.id);
        if (idx >= 0) insertAt = idx;
      }
      colCards.splice(insertAt, 0, next.find((c) => c.id === activeCard.id)!);
      colCards.forEach((c, i) => {
        const ref = next.find((n) => n.id === c.id)!;
        ref.order = i;
      });
      persist(colCards);
      return [...next];
    });
  }

  async function onDelete(id: string) {
    if (!confirm("¿Eliminar este contacto?")) return;
    setCards((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/v1/contacts/${id}`, { method: "DELETE" });
  }

  async function onAdd(stage: string) {
    const name = prompt("Nombre del contacto:");
    if (!name) return;
    const phone = prompt("Teléfono (opcional):") ?? "";
    const res = await fetch("/api/v1/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone: phone || undefined, stage }),
    });
    if (res.ok) {
      const { contact } = await res.json();
      setCards((prev) => [
        ...prev,
        {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          stage: contact.stage,
          order: contact.order,
          source: contact.source,
          nextAppointment: null,
        },
      ]);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <p className="text-sm text-slate-500">
          Las citas que agenda SONIA aparecen en la columna «Citas»
        </p>
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              cards={byColumn.get(col.id) ?? []}
              onDelete={onDelete}
              onAdd={onAdd}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? <ContactCard card={active} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
