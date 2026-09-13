const HOUR = 60 * 60 * 1000;

export function buildGmbCadencePlan(hasMobile: boolean, anchor: Date) {
  const items = hasMobile
    ? [
        { stage: "mobile_day1", offsetHours: 0 },
        { stage: "mobile_day3", offsetHours: 72 },
        { stage: "mobile_day8_whatsapp", offsetHours: 168 },
        { stage: "mobile_day8_email", offsetHours: 168 }
      ]
    : [
        { stage: "email_day1", offsetHours: 0 },
        { stage: "email_day3", offsetHours: 48 }
      ];
  return items.map((item) => ({ ...item, scheduledAt: new Date(anchor.getTime() + item.offsetHours * HOUR) }));
}
