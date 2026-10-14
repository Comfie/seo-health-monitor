import type { AuditContext, CheckStatus, IssueDraft } from "../types";
import { htmlPages, isUtilityPage, pass, plural, ratioOutcome, unavailable, type CheckDefinition } from "./helpers";

const homeUrl = (ctx: AuditContext) => ctx.homepage?.finalUrl ?? `${ctx.origin}/`;

export const conversionChecks: CheckDefinition[] = [
  {
    id: "conv-contact-form",
    category: "conversion",
    title: "Contact / quote form",
    description: "At least one page has an enquiry form (fields for email/phone/message) or an embedded form provider.",
    weight: 6,
    template: {
      title: "No contact or quote form found",
      severity: "high",
      why: "Many visitors prefer to send an enquiry rather than call, especially outside business hours. Without a form those leads are lost.",
      fix: "Add a short enquiry/quote form (name, phone, email, location, message) to the contact page and key service pages.",
      implementation:
        "Use a form plugin (WPForms, Gravity Forms, Contact Form 7) or a hosted form; keep it to 4–5 fields, add spam protection (Turnstile/reCAPTCHA or honeypot), and send notifications to a monitored inbox. Test that submissions are delivered.",
      benefit: "Captures enquiries from visitors who won't call.",
      impact: 4,
      effort: "low",
      confidence: "medium",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      if (!pages.length) return unavailable("No pages were fetched successfully.");
      const withForm = pages.filter((p) => p.extracted.forms.some((f) => f.hasEmail || f.hasPhone || f.hasMessage) || p.extracted.embeddedFormProviders.length);
      if (withForm.length) {
        const providers = [...new Set(withForm.flatMap((p) => p.extracted.embeddedFormProviders))];
        return pass(`Enquiry form found on ${plural(withForm.length, "page")} (e.g. ${withForm[0].finalUrl})${providers.length ? `; embedded providers: ${providers.join(", ")}` : ""}.`);
      }
      const jsPages = pages.some((p) => p.extracted.jsRendering.suspected);
      return {
        status: "fail",
        score: 0,
        summary: `No enquiry form found on ${plural(pages.length, "crawled page")}.`,
        drafts: [{ checkId: "conv-contact-form", url: homeUrl(ctx), confidence: jsPages ? "low" : undefined, evidence: ["No <form> with email/phone/message fields and no embedded form provider (Typeform, Jotform, HubSpot, Google Forms…) detected.", ...(jsPages ? ["Some pages render with JavaScript; a form injected by script would not be detected."] : [])] }],
      };
    },
  },
  {
    id: "conv-click-to-call",
    category: "conversion",
    title: "Click-to-call links",
    description: "Phone numbers are linked with tel: so mobile visitors can call in one tap; present on the homepage and most pages.",
    weight: 6,
    template: {
      title: "No click-to-call link",
      severity: "high",
      why: "Most local service enquiries happen on mobile. A tappable phone link removes friction; a plain-text number has to be copied manually.",
      fix: "Wrap the phone number in a tel: link in the header and on key pages, and add a prominent \"Call now\" button on mobile.",
      implementation: "<a href=\"tel:+[country code][number]\" class=\"btn\">Call [phone number]</a>. Use the international format in the href. Consider a sticky mobile call bar.",
      benefit: "More phone enquiries from mobile visitors.",
      impact: 4,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      if (!pages.length) return unavailable("No pages were fetched successfully.");
      const withTel = pages.filter((p) => p.extracted.telLinks.length);
      const home = pages.find((p) => p.depth === 0);
      const homeHas = !!home?.extracted.telLinks.length;
      if (!withTel.length) {
        const plainNumbers = pages.some((p) => p.extracted.phoneNumbers.length);
        return { status: "fail", score: 0, summary: "No tel: links found on any page.", drafts: [{ checkId: "conv-click-to-call", url: homeUrl(ctx), evidence: [plainNumbers ? "Phone numbers appear as plain text but are not tappable links." : "No phone numbers or tel: links found."] }] };
      }
      const drafts: IssueDraft[] = [];
      if (!homeHas) drafts.push({ checkId: "conv-click-to-call", url: homeUrl(ctx), title: "Homepage has no click-to-call link", evidence: [`tel: links found on ${withTel.length} other page(s), e.g. ${withTel[0].finalUrl}`] });
      const share = withTel.length / pages.length;
      if (homeHas && share < 0.8) drafts.push({ checkId: "conv-click-to-call", url: homeUrl(ctx), discriminator: "sitewide", title: "Click-to-call missing from many pages", severity: "low", evidence: [`tel: links on ${withTel.length} of ${pages.length} pages.`] });
      const status: CheckStatus = drafts.length === 0 ? "pass" : homeHas ? "warning" : "fail";
      return { status, score: homeHas ? 0.5 + share / 2 : share / 2, summary: `tel: links found on ${withTel.length} of ${plural(pages.length, "page")}${homeHas ? ", including the homepage" : ""}.`, drafts };
    },
  },
  {
    id: "conv-whatsapp",
    category: "conversion",
    title: "WhatsApp contact option",
    description: "A WhatsApp chat link (wa.me / api.whatsapp.com) is offered. Absence is an opportunity, not a failure.",
    weight: 2,
    template: {
      title: "No WhatsApp contact link",
      severity: "low",
      why: "In many markets customers prefer messaging over calls or forms. A WhatsApp link offers a low-friction way to enquire and share photos of the problem.",
      fix: "Add a WhatsApp button linking to https://wa.me/<number> with a pre-filled message.",
      implementation: "<a href=\"https://wa.me/[country code][number]?text=Hi%2C%20I%27d%20like%20a%20quote\">Chat on WhatsApp</a> — use the international number without + or spaces. Track clicks as a conversion in analytics.",
      benefit: "An extra, convenient enquiry channel; impact depends on your customers' habits.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      if (!pages.length) return unavailable("No pages were fetched successfully.");
      const withWa = pages.filter((p) => p.extracted.whatsappLinks.length);
      if (withWa.length) return pass(`WhatsApp link found on ${plural(withWa.length, "page")} (${withWa[0].extracted.whatsappLinks[0].slice(0, 60)}).`);
      return { status: "warning", score: 0.5, summary: "No WhatsApp link found.", drafts: [{ checkId: "conv-whatsapp", url: homeUrl(ctx), evidence: ["No wa.me, api.whatsapp.com or whatsapp: links found. A chat widget loaded by JavaScript would not be detected."] }] };
    },
  },
  {
    id: "conv-cta",
    category: "conversion",
    title: "Clear calls to action",
    description: "Content pages contain an explicit call to action (Call, Get a quote, Contact us, Book…). Utility pages are excluded.",
    weight: 5,
    template: {
      title: "No clear call to action",
      severity: "medium",
      why: "Visitors who are ready to buy need an obvious next step. Pages without a clear call to action leak enquiries.",
      fix: "Add a prominent, specific call to action near the top and at the end of the page (e.g. \"Get a free quote\", \"Call now\").",
      implementation: "Add a button block above the fold and a CTA section before the footer linking to the contact form/tel:/WhatsApp. Use action-led wording specific to the service.",
      benefit: "More visitors turned into enquiries.",
      impact: 3,
      effort: "low",
      confidence: "medium",
    },
    run(ctx) {
      const pages = htmlPages(ctx).filter((p) => !isUtilityPage(p.finalUrl));
      const drafts = pages
        .filter((p) => p.extracted.ctas.length === 0 && p.extracted.telLinks.length === 0 && p.extracted.whatsappLinks.length === 0)
        .map((p) => ({ checkId: "conv-cta", url: p.finalUrl, severity: p.depth === 0 ? ("high" as const) : undefined, evidence: ["No links/buttons with call-to-action wording, tel: or WhatsApp links found."] }));
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have no clear call to action.` : `All ${t} content pages include a call to action.`));
    },
  },
  {
    id: "conv-mobile-viewport",
    category: "conversion",
    title: "Mobile viewport configured",
    description: "Pages declare a responsive viewport (width=device-width) and don't disable zooming.",
    weight: 4,
    template: {
      title: "Mobile viewport problem",
      severity: "high",
      why: "Without a responsive viewport, phones render the desktop layout zoomed out, making text unreadable and buttons hard to tap. Disabling zoom hurts accessibility.",
      fix: "Use <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> and don't set maximum-scale=1 or user-scalable=no.",
      implementation: "Update the theme's <head> template (header.php or root layout).",
      benefit: "A usable mobile experience for the majority of visitors.",
      impact: 4,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const drafts: IssueDraft[] = [];
      for (const p of pages) {
        const vp = p.extracted.viewport;
        if (!vp) drafts.push({ checkId: "conv-mobile-viewport", url: p.finalUrl, title: "No viewport meta tag", evidence: ["<meta name=\"viewport\"> not found."] });
        else if (!/width\s*=\s*device-width/i.test(vp)) drafts.push({ checkId: "conv-mobile-viewport", url: p.finalUrl, title: "Viewport is not responsive", evidence: [`Viewport: ${vp}`] });
        else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(vp)) drafts.push({ checkId: "conv-mobile-viewport", url: p.finalUrl, discriminator: "zoom", title: "Viewport disables zooming", severity: "low", evidence: [`Viewport: ${vp}`] });
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have viewport problems.` : `All ${t} pages have a responsive viewport.`));
    },
  },
  {
    id: "conv-tap-targets",
    category: "conversion",
    title: "Tap target size & text legibility",
    description: "Whether buttons are large enough and text is readable on phones. Needs a rendered-page test.",
    weight: 0,
    template: { title: "", severity: "low", why: "", fix: "", implementation: "", benefit: "", impact: 1, effort: "low", confidence: "low" },
    run: () => unavailable("Requires a rendered mobile layout test; Lighthouse no longer reports tap targets and this tool reads raw HTML. Check manually on a phone."),
  },
];
