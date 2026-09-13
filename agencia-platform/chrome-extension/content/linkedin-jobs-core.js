(() => {
  "use strict";

  const clean = (value, max = 12000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

  function normalizedJobUrl(value) {
    try {
      const url = new URL(value);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/\/jobs\/view\/(\d+)/i);
      return match ? `https://www.linkedin.com/jobs/view/${match[1]}` : null;
    } catch {
      return null;
    }
  }

  function normalizedCompanyUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !url.pathname.includes("/company/")) return null;
      return `${url.origin}${url.pathname}`;
    } catch {
      return null;
    }
  }

  function buildPayload(input) {
    const company = clean(input?.company, 240);
    const jobTitle = clean(input?.jobTitle, 300);
    const jobUrl = normalizedJobUrl(input?.jobUrl);
    if (!company || !jobTitle || !jobUrl) return null;
    return {
      company,
      jobTitle,
      location: clean(input?.location, 300) || null,
      jobUrl,
      companyUrl: normalizedCompanyUrl(input?.companyUrl),
      description: clean(input?.description, 12000) || null
    };
  }

  globalThis.NVLinkedInJobsCore = Object.freeze({ buildPayload, normalizedJobUrl });
})();
