/** Explicit compatibility map. Unknown legacy routes never fall back to global SQLite. */
export function unifiedDestination(url: URL): { path: string; rewrite?: boolean } | null {
  const p = url.pathname;
  const audit = url.searchParams.get('audit');
  const id = audit && /^[1-9]\d{0,9}$/.test(audit) ? audit : null;
  if (p === '/api/health') return { path: '/api/beta/health', rewrite: true };
  if (/^\/api\/audits(?:\/|$)/.test(p)) return { path: p.replace('/api/audits', '/api/beta/audits').replace(/\/performance$/, '/pagespeed'), rewrite: true };
  if (/^\/api\/sites(?:\/|$)/.test(p)) return { path: p.replace('/api/sites', '/api/beta/websites'), rewrite: true };
  if (/^\/api\/integrations\/google(?:\/|$)/.test(p)) return { path: p.replace('/api/integrations/google', '/api/beta/google'), rewrite: true };
  const pages: Record<string, string> = {
    '/': id ? `/beta/audits/${id}` : '/beta', '/login': '/beta/login', '/register': '/beta/register',
    '/forgot-password': '/beta/forgot-password', '/reset-password': '/beta/reset-password',
    '/websites': '/beta/websites', '/settings': '/beta/account', '/account': '/beta/account',
    '/admin': '/beta/admin', '/admin/operations': '/beta/admin/operations',
    '/privacy': '/beta/privacy', '/terms': '/beta/terms', '/data-use': '/beta/data-use',
    '/search-console': '/beta/search-console', '/audits': '/beta/audits', '/audits/new': '/beta',
    '/audits/compare': '/beta/audits/compare', '/progress': '/beta/progress',
    '/reports': id ? `/beta/audits/${id}` : '/beta/audits',
    '/fix': id ? `/beta/audits/${id}/fix` : '/beta/audits',
  };
  if (pages[p]) return { path: pages[p] };
  if (/^\/audits\/[1-9]\d{0,9}(?:\/report)?$/.test(p)) return { path: '/beta' + p.replace(/\/report$/, '') };
  if (['/technical', '/on-page', '/performance', '/local', '/recommendations'].includes(p)) {
    if (!id) return { path: '/beta/audits' };
    const category = p === '/on-page' ? 'onpage' : p.slice(1);
    return { path: `/beta/audits/${id}/findings${p === '/recommendations' ? '' : `?category=${category}`}` };
  }
  return null;
}
