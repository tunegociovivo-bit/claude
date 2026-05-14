import { getMember } from "@/lib/mock-data";

export default function AvatarStack({ ids, size = 7 }: { ids: string[]; size?: number }) {
  return (
    <div className="flex -space-x-2">
      {ids.map((id) => {
        const m = getMember(id);
        if (!m) return null;
        return (
          <div
            key={id}
            className={`${m.color} text-white grid place-items-center font-semibold ring-2 ring-white rounded-full`}
            style={{ height: size * 4, width: size * 4, fontSize: size * 1.6 }}
            title={m.name}
          >
            {m.initials}
          </div>
        );
      })}
    </div>
  );
}
