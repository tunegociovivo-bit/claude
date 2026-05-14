import { team as mockTeam } from "@/lib/mock-data";

type Member = { id: string; name: string; initials: string; color: string };

export default function AvatarStack({
  ids,
  size = 7,
  members
}: {
  ids: string[];
  size?: number;
  members?: Member[];
}) {
  const lookup = members ?? mockTeam;
  return (
    <div className="flex -space-x-2">
      {ids.map((id) => {
        const m = lookup.find((x) => x.id === id);
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
