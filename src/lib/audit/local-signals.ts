import type { AuditContext } from "./types";
import { htmlPages, type HtmlPage } from "./checks/helpers";

const LOCAL_BUSINESS_TYPES = new Set(
  (
    "LocalBusiness HomeAndConstructionBusiness Plumber Electrician GeneralContractor HVACBusiness RoofingContractor HousePainter Locksmith MovingCompany " +
    "ProfessionalService AutomotiveBusiness AutoRepair AutoDealer HealthAndBeautyBusiness BeautySalon HairSalon DaySpa Dentist MedicalBusiness MedicalClinic Physician " +
    "LegalService Attorney Notary FinancialService AccountingService InsuranceAgency FoodEstablishment Restaurant CafeOrCoffeeShop Bakery BarOrPub Store " +
    "HardwareStore LodgingBusiness Hotel BedAndBreakfast RealEstateAgent EmergencyService EntertainmentBusiness SportsActivityLocation ExerciseGym TravelAgency " +
    "ChildCare DryCleaningOrLaundry EmploymentAgency SelfStorage AnimalShelter VeterinaryCare RecyclingCenter TouristInformationCenter ShoppingCenter"
  ).split(/\s+/),
);

const NOT_PLACES = new Set(
  (
    "the our your all any every we us you call contact get free quality professional reliable affordable best top residential commercial industrial " +
    "emergency services service area areas monday tuesday wednesday thursday friday saturday sunday january february march april may june july august " +
    "september october november december home about more read learn request quote today now hours experience years team customers clients"
  ).split(" "),
);

const AREA_PHRASE =
  /\b(?:serving|servicing|service areas?|areas? (?:we )?(?:serve|cover|service)|we (?:serve|cover|service|operate in|work in)|throughout|across|in and around|based in|located in|operating in)\b\s*:?\s*((?:[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3})(?:\s*(?:,|&|\/|\band\b)\s*(?:the\s+)?[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3}){0,20})/gu;
const AREA_MENTION = /\b(service areas?|areas? (?:we )?(?:serve|cover)|we (?:serve|cover|service)|serving|servicing|throughout|surrounding areas|nationwide|province|region)\b/i;
const LOCATION_PATH = /\/(areas?(-we-(serve|cover))?|locations?|service-areas?|regions?|branches?|near-me|cities|towns|suburbs)(\/|-|$)/i;

export interface LocalSignals {
  businessName: { value: string; source: string } | null;
  businessNameVisible: boolean;
  phones: string[];
  phonePages: string[];
  emails: string[];
  addresses: { value: string; source: string }[];
  localBusinessSchema: { url: string; types: string[]; item: Record<string, unknown> }[];
  organizationSchema: boolean;
  areaServed: string[];
  placeCandidates: string[];
  serviceAreaPages: string[];
  locationPages: { url: string; reason: string }[];
  mapsLinks: string[];
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string[] {
  return asArray(value).flatMap((v) => {
    if (typeof v === "string") return [v];
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return [o.name, o.addressLocality, o.addressRegion].filter((x): x is string => typeof x === "string");
    }
    return [];
  });
}

export function isLocalBusinessType(types: string[]): boolean {
  return types.some((t) => LOCAL_BUSINESS_TYPES.has(t) || /(Business|Contractor|Service|Store|Clinic|Agency)$/.test(t));
}

export function extractPlaceCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(AREA_PHRASE)) {
    for (const part of match[1].split(/\s*(?:,|&|\/|\band\b)\s*/)) {
      const place = part.replace(/^the\s+/i, "").trim();
      const first = place.split(/\s+/)[0]?.toLowerCase();
      if (!place || place.length < 3 || place.length > 40 || NOT_PLACES.has(first) || NOT_PLACES.has(place.toLowerCase())) continue;
      out.add(place);
    }
  }
  return [...out].slice(0, 40);
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function commonTitleSegment(pages: HtmlPage[]): string | null {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const parts = (p.extracted.title ?? "").split(/\s+[|–—:-]\s+/).map((s) => s.trim()).filter((s) => s.length > 2);
    for (const part of new Set(parts)) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && pages.length >= 2 && best[1] >= Math.max(2, pages.length * 0.5) ? best[0] : null;
}

export function collectLocalSignals(ctx: AuditContext): LocalSignals {
  const pages = htmlPages(ctx);
  const home = pages.find((p) => p.depth === 0) ?? pages[0];

  const localBusinessSchema: LocalSignals["localBusinessSchema"] = [];
  let organizationSchema = false;
  const addresses: LocalSignals["addresses"] = [];
  const areaServed = new Set<string>();
  let schemaName: string | null = null;

  for (const p of pages) {
    for (const block of p.extracted.jsonLd) {
      for (const item of block.items) {
        const types = asArray(item["@type"]).map(String);
        if (types.includes("Organization") || isLocalBusinessType(types)) {
          organizationSchema = true;
          if (!schemaName && typeof item.name === "string") schemaName = item.name;
        }
        if (isLocalBusinessType(types)) {
          localBusinessSchema.push({ url: p.finalUrl, types, item });
          for (const place of textOf(item.areaServed)) areaServed.add(place);
          const addr = item.address as Record<string, unknown> | string | undefined;
          const addAddress = (value: string) => {
            if (!addresses.some((a) => a.value === value)) addresses.push({ value, source: `Structured data on ${p.finalUrl}` });
          };
          if (typeof addr === "string") addAddress(addr);
          else if (addr && typeof addr === "object") {
            const value = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
              .map((k) => addr[k])
              .filter((v) => typeof v === "string" && v)
              .join(", ");
            if (value) addAddress(value);
            for (const k of ["addressLocality", "addressRegion"]) if (typeof addr[k] === "string") areaServed.add(addr[k] as string);
          }
        }
      }
    }
    for (const snippet of p.extracted.addressSnippets) {
      if (addresses.length < 8 && !addresses.some((a) => a.value === snippet)) addresses.push({ value: snippet, source: `Page text on ${p.finalUrl}` });
    }
  }

  const siteName = home?.extracted.og["og:site_name"];
  const titleBrand = commonTitleSegment(pages);
  const businessName = schemaName
    ? { value: schemaName, source: "Organization/LocalBusiness structured data" }
    : siteName
      ? { value: siteName, source: "og:site_name" }
      : titleBrand
        ? { value: titleBrand, source: "Repeated segment of page titles" }
        : null;
  const businessNameVisible = !!businessName && !!home && home.extracted.bodyText.toLowerCase().includes(businessName.value.toLowerCase());

  const phones = new Set<string>();
  const phonePages: string[] = [];
  const emails = new Set<string>();
  for (const p of pages) {
    const found = [...p.extracted.telLinks, ...p.extracted.phoneNumbers];
    found.forEach((f) => phones.add(f));
    if (found.length) phonePages.push(p.finalUrl);
    p.extracted.emails.forEach((e) => emails.add(e));
  }

  const placeCandidates = new Set<string>(areaServed);
  for (const p of pages) extractPlaceCandidates(p.extracted.bodyText).forEach((c) => placeCandidates.add(c));
  const serviceAreaPages = pages.filter((p) => AREA_MENTION.test(p.extracted.bodyText) || placeCandidates.size > 0 && [...placeCandidates].some((c) => p.extracted.bodyText.includes(c))).map((p) => p.finalUrl);

  const locationPages: LocalSignals["locationPages"] = [];
  const placeSlugs = [...placeCandidates].map((c) => ({ place: c, slug: slug(c) })).filter((c) => c.slug.length >= 3);
  for (const p of pages) {
    if (p.depth === 0) continue;
    const path = new URL(p.finalUrl).pathname.toLowerCase();
    const heading = `${p.extracted.title ?? ""} ${p.extracted.h1s.join(" ")}`;
    const placeInPath = placeSlugs.find((c) => path.includes(c.slug));
    const placeInHeading = [...placeCandidates].find((c) => heading.includes(c));
    if (placeInPath) locationPages.push({ url: p.finalUrl, reason: `URL contains place name "${placeInPath.place}"` });
    else if (LOCATION_PATH.test(path)) locationPages.push({ url: p.finalUrl, reason: "URL path indicates a location / service-area page" });
    else if (placeInHeading && /\b(in|near|around)\s/i.test(heading)) locationPages.push({ url: p.finalUrl, reason: `Title/H1 targets "${placeInHeading}"` });
  }

  return {
    businessName,
    businessNameVisible,
    phones: [...phones].slice(0, 10),
    phonePages,
    emails: [...emails].slice(0, 10),
    addresses: addresses.slice(0, 8),
    localBusinessSchema,
    organizationSchema,
    areaServed: [...areaServed],
    placeCandidates: [...placeCandidates],
    serviceAreaPages,
    locationPages,
    mapsLinks: [...new Set(pages.flatMap((p) => p.extracted.mapsLinks))].slice(0, 5),
  };
}
