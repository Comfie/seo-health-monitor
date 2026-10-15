import Link from 'next/link';
export function PrivacyLinks(){return <nav aria-label="Privacy and terms" className="mt-8 flex flex-wrap gap-4 text-sm"><Link className="underline" href="/beta/privacy">Privacy Policy</Link><Link className="underline" href="/beta/terms">Terms of Use</Link><Link className="underline" href="/beta/data-use">Crawling and data use</Link></nav>;}
export function privacyContactEmail(){
  const contact=process.env.PHASE2_PRIVACY_CONTACT_EMAIL?.trim();
  return contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null;
}
export function PrivacyContact(){
  const contact=privacyContactEmail();
  return <p>For privacy, access, correction, deletion or security requests, {contact ? <>email <a className="underline" href={`mailto:${contact}`}>{contact}</a>.</> : <>reply to your invitation email.</>}</p>;
}
