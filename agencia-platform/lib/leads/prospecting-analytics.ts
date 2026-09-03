type ConversionProspect = {
  id: string;
  status: string;
  lastContactedAt: Date | string | null;
  repliedAt: Date | string | null;
};

export function buildProspectingConversion(prospects: ConversionProspect[], wonProspectIds: Iterable<string>) {
  const won = new Set(wonProspectIds);
  const reachedReply = (prospect: ConversionProspect) => Boolean(prospect.repliedAt) || ["replied", "qualified", "meeting"].includes(prospect.status) || won.has(prospect.id);
  const reachedQualification = (prospect: ConversionProspect) => ["qualified", "meeting"].includes(prospect.status) || won.has(prospect.id);
  const reachedMeeting = (prospect: ConversionProspect) => prospect.status === "meeting" || won.has(prospect.id);
  const contacted = prospects.filter(prospect => Boolean(prospect.lastContactedAt) || reachedReply(prospect)).length;
  const replied = prospects.filter(reachedReply).length;
  const qualified = prospects.filter(reachedQualification).length;
  const meetings = prospects.filter(reachedMeeting).length;
  return {
    total: prospects.length,
    contacted,
    replied,
    qualified,
    meetings,
    won: won.size,
    replyRate: contacted ? Math.round((replied / contacted) * 1000) / 10 : 0,
    qualificationRate: replied ? Math.round((qualified / replied) * 1000) / 10 : 0,
    meetingRate: qualified ? Math.round((meetings / qualified) * 1000) / 10 : 0,
    winRate: meetings ? Math.round((won.size / meetings) * 1000) / 10 : 0
  };
}
