import Link from 'next/link';
export function PrivacyLinks(){return <nav aria-label="Privacy and terms" className="mt-8 flex flex-wrap gap-4 text-sm"><Link className="underline" href="/beta/privacy">Privacy Policy (draft)</Link><Link className="underline" href="/beta/terms">Terms (draft)</Link><Link className="underline" href="/beta/data-use">Crawling and data use</Link></nav>;}
export function PrivacyContact(){
  const contact=process.env.PHASE2_PRIVACY_CONTACT_EMAIL;
  return <p>For privacy, access, correction, deletion or security requests, {contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? <>email <a className="underline" href={`mailto:${contact}`}>{contact}</a>.</> : <>reply to the beta invitation email or contact the operator who invited you. A dedicated privacy address is awaiting operator confirmation.</>}</p>;
}
