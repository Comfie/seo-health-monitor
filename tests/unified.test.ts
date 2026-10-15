import {afterEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
import {readBetaConfig, readGoogleConfig} from '@/lib/saas/config';
import {googleCookiePath} from '@/lib/saas/search-console';
import {proxy} from '@/proxy';
import {guard} from '@/lib/security/guard';
import {getDb} from '@/lib/db';
import {unifiedDestination} from '@/lib/saas/unified-routes';
const env={NODE_ENV:'test' as const,PHASE2_ENABLED:'true',PHASE2_UNIFIED:'true',PHASE2_GOOGLE_REUSE_LEGACY_CLIENT:'true',PHASE2_DATABASE_URL:'postgresql://isolated/unified',PHASE2_ORIGIN:'https://app.example.com',PHASE2_AUTH_SECRET:'a'.repeat(40),APP_SECRET:'b'.repeat(40),GOOGLE_CLIENT_ID:'existing-client',GOOGLE_CLIENT_SECRET:'existing-secret',PHASE2_GOOGLE_TOKEN_SECRET:'t'.repeat(40),EMAIL_TRANSPORT:'log'};
afterEach(()=>vi.unstubAllEnvs());
describe('unified application boundaries',()=>{
 it('supports explicit existing-client reuse with the preserved callback and API-scoped browser binding',()=>{
  const g=readGoogleConfig(env,'https://app.example.com',env.PHASE2_AUTH_SECRET);
  expect(g).toMatchObject({state:'ready',clientId:'existing-client',clientSecret:'existing-secret',sharedLegacyClient:true,redirectUri:'https://app.example.com/api/integrations/google/callback'});
  expect(googleCookiePath(g)).toBe('/api');
  expect(readGoogleConfig({...env,PHASE2_GOOGLE_CLIENT_ID:'other'},'https://app.example.com',env.PHASE2_AUTH_SECRET).state).toBe('unavailable');
  expect(readGoogleConfig({...env,PHASE2_GOOGLE_TOKEN_SECRET:env.APP_SECRET},'https://app.example.com',env.PHASE2_AUTH_SECRET).state).toBe('unavailable');
  expect(readGoogleConfig({...env,PHASE2_GOOGLE_REUSE_LEGACY_CLIENT:'false'},'https://app.example.com',env.PHASE2_AUTH_SECRET).state).toBe('unavailable');
 });
 it('routes old report URLs to tenant handlers, retires global endpoints and ignores legacy owner cookies',()=>{
  for(const[k,v]of Object.entries(env))vi.stubEnv(k,v);
  for(const[path,target]of [['/api/audits/7/export?format=pdf','/api/beta/audits/7/export?format=pdf'],['/api/sites/4/search-console','/api/beta/websites/4/search-console'],['/api/integrations/google/callback?state=x','/api/beta/google/callback?state=x'],['/api/health','/api/beta/health']]){
   const res=proxy(new NextRequest('https://app.example.com'+path));expect(res.headers.get('x-middleware-rewrite')).toBe('https://app.example.com'+target);
  }
  // Rewrites stay on the receiving server: platform health checks arrive on an internal host and
  // must not be proxied through the public origin (which still serves the old release mid-deploy).
  expect(proxy(new NextRequest('http://10.0.0.5:3000/api/health')).headers.get('x-middleware-rewrite')).toBe('http://10.0.0.5:3000/api/beta/health');
  expect(proxy(new NextRequest('https://app.example.com/audits/7/report')).headers.get('location')).toBe('https://app.example.com/beta/audits/7');
  expect(proxy(new NextRequest('https://app.example.com/api/auth/login',{method:'POST',headers:{origin:'https://app.example.com'}})).status).toBe(404);
  expect(proxy(new NextRequest('https://app.example.com/beta',{headers:{cookie:'shm_session=legacy'}})).headers.get('location')).toBe('https://app.example.com/beta/login');
  expect(proxy(new NextRequest('https://app.example.com/api/audits',{method:'POST',headers:{origin:'https://evil.example'}})).status).toBe(403);
  expect(guard(new Request('https://app.example.com/api/audits'))?.status).toBe(410);
  expect(()=>getDb()).toThrow('Legacy SQLite access is disabled');
  vi.stubEnv('PHASE2_ENABLED','false');expect(proxy(new NextRequest('https://app.example.com/')).status).toBe(503);
 });
 it('maps bookmarks without accepting a caller supplied tenant or arbitrary destination',()=>{
  expect(unifiedDestination(new URL('https://app.example.com/technical?audit=7'))).toEqual({path:'/beta/audits/7/findings?category=technical'});
  expect(unifiedDestination(new URL('https://app.example.com/fix?audit=../other'))).toEqual({path:'/beta/audits'});
  expect(unifiedDestination(new URL('https://app.example.com/unknown'))).toBeNull();
  expect(readBetaConfig({...env,AUTH_DISABLED:'true'}).state).toBe('misconfigured');
 });
});
